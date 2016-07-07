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
  this.requestPath = path.join(options.static, this.request.path);

  // Make sure user is requesting a valid file
  this.validPath().then(info => {
    this.info = info; // Save info regarding file

    // Check if directory
    if (this.info.dir) {

      // Check for directory listing
      if (options['showDir']) {
        this.dirList();

      // Check for index file and return 404 if not found
      } else {
        this.serveIndex();
      }

    // If it is a file, serve it
    } else {

      // Partial content 206 headers
      if (this.headers.range !== undefined) {
        this.partialContent();

      // Normal static files/CGI
      } else {

        // CGI Script
        if (this.inCGIFolder() && this.isExecutable()) {
          this.cgiScript();

        // Normal static file
        } else {
          this.staticFile();
        }
      }
    }

  // Invalid path = not found or malformed request
  }, () => {
    this.invalidPath();
  });
}

util.inherits(Handler, EventEmitter);

Handler.prototype.done = function() {
  setImmediate(() => {
    this.emit('done', this.response);
  });
};

Handler.prototype.dirList = function() {
  utils.genDirectoryListing(path.resolve(this.requestPath), path.resolve(this.request.path)).then(body => {
    utils.genLog(200, this.request);
    this.response.setStatus(200);
    this.response.setBody(body);
    this.response.setType("dirList");
    this.done();
  }, () => {
    // Server error/something bad happened
    utils.genLog(500, this.request);
    this.response.setStatus(500);
    this.done();
  });
};

Handler.prototype.serveIndex = function() {
  // Check if it has an index file
  this.hasIndex().then(stat => {
    let fileEtag = etag(stat);
    let code = 200;

    this.response.setEtag(fileEtag);
    if (this.headers['if-none-match'] === fileEtag) {
      code = 304;
    }

    utils.genLog(code, this.request);
    this.response.setStatus(code);
    this.response.setSize(stat.size);
    this.response.setMime(mime.contentType(path.extname(path.join(this.requestPath, options['index']))) || 'application/octet-stream');
    this.response.setStream(path.join(this.requestPath, options['index']), () => {
      this.done();
    });

  // No index file
  }, () => {
    utils.genLog(403, this.request);
    this.response.setStatus(403);
    this.done();
  })
};

Handler.prototype.partialContent = function() {
  let rangeRequest = utils.readRangeHeader(this.headers.range, this.info.stat.size);

  let start = rangeRequest.start;
  let end   = rangeRequest.end;

  // If invalid range
  if (start >= this.info.stat.size || end >= this.info.stat.size) {
    this.response.setType("invalidRange");
    this.response.setSize(this.info.stat.size);

    // Send proper range
    utils.genLog(416, this.request);
    this.response.setStatus(416);
    this.done();
  } else {
    utils.genLog(206, this.request);
    this.response.setStatus(206);
    this.response.setType("validRange");
    this.response.setSize({start, end, total: this.info.stat.size});
    this.response.setMime(mime.contentType(path.extname(this.requestPath)) || 'application/octet-stream');
    this.response.setStream(this.requestPath, {start, end}, () => {
      this.done();
    });
  }
};

Handler.prototype.cgiScript = function() {
  let cgi = new CGI.create(this.requestPath, this.request);
  try {
    cgi.run();
    cgi.on('done', data => {
      utils.genLog(data.status, this.request);
      this.response.setType("CGI");
      this.response.setHeaders(data.headers);
      this.response.setBody(data.body);
      this.response.setStatus(data.status);
      this.done();
    });
  } catch (e) {
    utils.genLog(500, this.request);
    this.response.setStatus(500);
    this.done();
  }
};

Handler.prototype.staticFile = function() {
  let fileEtag = etag(this.info.stat);
  let code = 200;

  this.response.setEtag(fileEtag);
  if (this.headers['if-none-match'] === fileEtag) {
    code = 304;
  }

  utils.genLog(code, this.request);
  this.response.setStatus(code);
  this.response.setSize(this.info.stat.size);
  this.response.setMime(mime.contentType(path.extname(this.requestPath)) || 'application/octet-stream');
  this.response.setStream(this.requestPath, () => {
    this.done();
  });
};

Handler.prototype.invalidPath = function() {
  let verbs = [
    'GET', 'POST', 'PUT', 'PATCH',
    'DELETE', 'COPY', 'HEAD', 'OPTIONS'
  ];

  // Invalid verb
  if (verbs.indexOf(this.request.getVerb()) === -1) {
    utils.genLog(400, this.request);
    this.response.setStatus(400);
  } else {
    utils.genLog(404, this.request);
    this.response.setStatus(404);
  }
  this.done();
};

Handler.prototype.hasIndex = function() {
  return new Promise((resolve, reject) => {
    fs.statAsync(this.requestPath).then(dir => {
      if (dir.isDirectory()) {
        fs.statAsync(path.join(this.requestPath, options['index'])).then(stats => {
          resolve(stats);
        }, err => {
          reject(false);
        });
      } else {
        reject(false);
      }
    });
  });
};

Handler.prototype.validPath = function() {
  return new Promise((resolve, reject) => {
    fs.statAsync(this.requestPath).then(stat => {
      resolve({dir: stat.isDirectory(), stat});
    }, (asf) => {
      reject(false);
    });
  });
};

Handler.prototype.inCGIFolder = function() {
  return this.requestPath.indexOf(options.cgibin) === 0;
};

Handler.prototype.isExecutable = function() {
  let res = fs.statSync(this.requestPath);
  return !!(1 & parseInt ((res.mode & parseInt ("777", 8)).toString (8)[0]));
};

// Receive options
function init(ops) {
  options = ops;
}

module.exports = {
  init,
  create: Handler
};
