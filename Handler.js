// File Handler (send file or stream if partial content request)
// Directory Handler (search for index or display directory contents)
// CGI Handler (pass script to child process)
const util     = require('util');
const path     = require('path');
const etag     = require('etag');
const Promise  = require('bluebird');
const mime     = require('mime-types');

const Response = require('./Response');
const utils    = require('./utils');

const fs = Promise.promisifyAll(require("fs"));
const EventEmitter = require('events').EventEmitter;

let options;

function Handler(request, headers) {
  this.request  = request;
  this.headers  = headers;
  this.response = new Response.create();

  // Create the full path of the request
  let requestPath = path.join(options.static, this.request.path);

  validPath(requestPath).then(info => {

    // Check if directory
    if (info.dir) {

      // Check for directory listing
      if (options['showDir']) {
        utils.genDirectoryListing(path.resolve(requestPath), path.resolve(this.request.path)).then(body => {
          utils.genLog(200, request);
          this.response.setStatus(200);
          this.response.setBody(body);
          this.response.setType("dirList");
          this.done();
        }, () => {
          // Server error/something bad happened
          utils.genLog(500, request);
          this.response.setStatus(500);
          this.done();
        });
        return;
      } else {
        // Check if it has an index file
        hasIndex(requestPath).then(stat => {
          let fileEtag = etag(stat);
          let code = 200;

          this.response.setEtag(fileEtag);
          if (this.headers['if-none-match'] === fileEtag) {
            code = 304;
          }

          utils.genLog(code, request);
          this.response.setStatus(code);
          this.response.setSize(stat.size);
          this.response.setMime(mime.contentType(path.extname(path.join(requestPath, options['index']))) || 'application/octet-stream');
          this.response.setStream(path.join(requestPath, options['index']), () => {
            this.done(this.response);
          });
          return;

        // No index file
        }, () => {
          utils.genLog(403, request);
          this.response.setStatus(403);
          this.done();
          return;
        })
      }

    // If it is a file, serve it
    } else {
      if (this.headers.range !== undefined) {
        let rangeRequest = utils.readRangeHeader(this.headers.range, info.stat.size);

        let start = rangeRequest.start;
        let end   = rangeRequest.end;

        // If invalid range
        if (start >= info.stat.size || end >= info.stat.size) {
          this.response.setType("invalidRange");
          this.response.setSize(info.stat.size);

          // Send [roper range
          utils.genLog(416, request);
          this.response.setStatus(416);
          this.done();
          return;
        } else {
          utils.genLog(206, request);
          this.response.setStatus(206);
          this.response.setType("validRange");
          this.response.setSize({start, end, total: info.stat.size});
          this.response.setMime(mime.contentType(path.extname(requestPath)) || 'application/octet-stream');
          //`Last-Modified: ${moment(stats.mtime).tz("Africa/Bissau").format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`,

          this.response.setStream(requestPath, {start, end}, () => {
            this.done(this.response);
          });
          return;
        }

      // Normal static files
      } else {
        // At this point, we should add checks for cgi-bin scripts
        let fileEtag = etag(info.stat);
        let code = 200;

        this.response.setEtag(fileEtag);
        if (this.headers['if-none-match'] === fileEtag) {
          code = 304;
        }

        utils.genLog(code, request);
        this.response.setStatus(code);
        this.response.setSize(info.stat.size);
        this.response.setMime(mime.contentType(path.extname(requestPath)) || 'application/octet-stream');
        this.response.setStream(requestPath, () => {
          this.done(this.response);
        });
        return;
      }
    }

  // Invalid path = not found
  }, () => {
    utils.genLog(404, request);
    this.response.setStatus(404);
    this.done();
  });
}

Handler.prototype.done = function() {
  setImmediate(() => {
    this.emit('done', this.response);
  });
};

util.inherits(Handler, EventEmitter);

// Receive options
function init(ops) {
  options = ops;
}

function hasIndex(requestPath) {
  return new Promise((resolve, reject) => {
    fs.statAsync(requestPath).then(dir => {
      if (dir.isDirectory()) {
        fs.statAsync(path.join(requestPath, options['index'])).then(stats => {
          resolve(stats);
        }, err => {
          reject(false);
        });
      } else {
        reject(false);
      }
    });
  });
}

function validPath(requestPath) {
  return new Promise((resolve, reject) => {
    fs.statAsync(requestPath).then(stat => {
      resolve({dir: stat.isDirectory(), stat});
    }, (asf) => {
      reject(false);
    });
  });
}
module.exports = {
  init,
  create: Handler
};