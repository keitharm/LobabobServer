// File Handler (send file or stream if partial content request)
// Directory Handler (search for index or display directory contents)
// CGI Handler (pass script to child process)
const util     = require('util');
const path     = require('path');
const etag     = require('etag');
const Promise  = require('bluebird');
const mime     = require('mime-types');

const Response = require('./Response');
const CGI      = require('./CGI');
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

  // Make sure user is requesting a valid file
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
            this.done();
          });

        // No index file
        }, () => {
          utils.genLog(403, request);
          this.response.setStatus(403);
          this.done();
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

          // Send proper range
          utils.genLog(416, request);
          this.response.setStatus(416);
          this.done();
        } else {
          utils.genLog(206, request);
          this.response.setStatus(206);
          this.response.setType("validRange");
          this.response.setSize({start, end, total: info.stat.size});
          this.response.setMime(mime.contentType(path.extname(requestPath)) || 'application/octet-stream');
          this.response.setStream(requestPath, {start, end}, () => {
            this.done();
          });
        }

      // Normal static files
      } else {

        // CGI Script
        if (inCGIFolder(requestPath) && isExecutable(requestPath)) {
          let cgi = new CGI.create(requestPath, this.request);
          try {
            cgi.run();
            cgi.on('done', data => {
              utils.genLog(data.status, request);
              this.response.setType("CGI");
              this.response.setHeaders(data.headers);
              this.response.setBody(data.body);
              this.response.setStatus(data.status);
              this.done();
            });
          } catch (e) {
            utils.genLog(500, request);
            this.response.setStatus(500);
            this.done();
          }
        // Normal static file
        } else {
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
            this.done();
          });
        }
      }
    }

  // Invalid path = not found or malformed request
  }, () => {
    let verbs = [
      'GET', 'POST', 'PUT', 'PATCH',
      'DELETE', 'COPY', 'HEAD', 'OPTIONS'
    ];

    // Invalid verb
    if (verbs.indexOf(this.request.getVerb()) === -1) {
      utils.genLog(400, request);
      this.response.setStatus(400);
    } else {
      utils.genLog(404, request);
      this.response.setStatus(404);
    }
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

function inCGIFolder(requestPath) {
  return requestPath.indexOf(options.cgibin) === 0;
}

function isExecutable(path){
    let res = fs.statSync(path);
    return !!(1 & parseInt ((res.mode & parseInt ("777", 8)).toString (8)[0]));
};

module.exports = {
  init,
  create: Handler
};
