const fs     = require('fs');
const net    = require('net');
const path   = require('path');
const _      = require('lodash');

const parse  = require('parse-headers');
const mime   = require('mime-types');
const moment = require('moment-timezone');
const etag   = require('etag');
const decode = require('urldecode');

const statusCodes = require('./statusCodes.json');
const VERSION     = "0.1";

function Lobabob(options) {
  this.options = options;
  this.setDefaults();

  // Directory to serve static files from
  this.set('static', path.resolve(this.get('static')));
  this.debug(this.options);
}

// Getters & Setters to interact with options
Lobabob.prototype.set = function(prop, val) {
  this.options[prop] = val;
};

Lobabob.prototype.get = function(prop, val) {
  return this.options[prop];
};

// Default settings
Lobabob.prototype.setDefaults = function() {
  let defaultOptions = {
    port:   1337,
    static: '', // default static to current directory
    debug:  false,
    index:  'index.html',
    showDir: false
  };

  // Replace missing options with default values
  this.options = _.defaults(this.options, defaultOptions);
};

// Start listening and handling requests
Lobabob.prototype.start = function() {
  console.log(`Lobabob server listening on port ${this.get('port')}`);

  this.server = net.createServer(sock => {
    let buffer = "";
    let input;

    sock.on('data', data => {
      input = data.toString();
      buffer += input;
      if (buffer.slice(-4) === '\r\n\r\n') {
        this.parseHeaders(buffer, sock);
      }
    });

    sock.on('error', err => {
      this.debug(err);
    });

  }).listen(this.get('port'));
};

Lobabob.prototype.parseHeaders = function(data, sock) {
  // Extract headers along with verb and path
  let resourceInfo = data.slice(0, data.indexOf('\r\n')).split(' ');
  let headers = parse(data);

  let request = {
    verb: resourceInfo[0],
    path: decode(resourceInfo[1])
  };

  // Only allow GET requests for now
  if (request.verb !== 'GET') {
    this.genLog(405, request, sock);
    sock.end(this.genHeaders(405, null, ['Content-Length: 0']));
  } else {
    this.resourceHandler(headers, request, sock);
  }
};

Lobabob.prototype.debug = function() {
  if (this.get('debug')) console.log.apply(null, arguments);
};

// Generate proper headers given the error code
Lobabob.prototype.genHeaders = function(code, body, extra = []) {
  let headers = [
    `HTTP/1.1 ${code} ${statusCodes[code]}`,
    `Server: Lobabob v${VERSION}`,
    'Access-Control-Allow-Methods: GET',
    ...extra,
    'Connection: keep-alive',
    `Date: ${moment(new Date().getTime()).format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`
  ];

  headers.push('');
  if (code === 404) {
    headers.push('The requested resource was not found.');
  } else if (code === 403) {
    headers.push('You do not have permission to access this resource.');
  } else if (code === 401) {
    headers.push('You are not authorized to access this resource.');
  } else {
    headers.push(body);
  }
  return headers.join('\r\n');
};

Lobabob.prototype.genLog = function(code, request, sock) {
  this.debug(request.verb + " " + request.path + " " + this.statusColor(code) + " " + sock.remoteAddress + ':' + sock.remotePort);
};

Lobabob.prototype.resourceHandler = function(headers, request, sock) {
  let requestPath = path.join(this.get('static'), request.path);

  const error = code => {
    this.genLog(code, request, sock);
    sock.end(this.genHeaders(code));
  };

  fs.stat(requestPath, (err, stats) => {
    // If this was a recursive call to check for the index file, remove it from the path
    if (request.dir) {
      request.path = request.path.slice(0, request.path.indexOf(this.get('index')));
    }

    if (err) {
      error(404);
    } else if (stats.isDirectory()) {

      // Directory Listing is true
      if (this.get('showDir')) {
        this.genDirectoryListing(path.resolve(requestPath), path.resolve(request.path), body => {
          if (body === "") {
            error(500);
          } else {
            this.genLog(200, request, sock);
            sock.write(this.genHeaders(200, body, [
              `Content-Type: text/html;charset=UTF-8`,
              `Content-Length: ${body.length}`,
              'Cache-Control: no-cache'
            ]));
          }
        });
      } else {
        request.path = path.join(request.path, this.get('index'));
        request.dir = true;
        this.resourceHandler(headers, request, sock);
      }
    } else {

      // Check for etags in order to return 304 without content
      let oldetag = headers['if-none-match'];
      if (etag(stats) === oldetag) {
        this.genLog(304, request, sock);
        sock.write(this.genHeaders(304));
        sock.end();
      } else {

        // For streaming binary files with partialcontent
        if (headers.range !== undefined) {
          let rangeRequest = this.readRangeHeader(headers.range, stats.size);

          let start = rangeRequest.Start;
          let end   = rangeRequest.End;

          // If invalid range
          if (start >= stats.size || end >= stats.size) {

            // Proper range
            newHeaders.push(`Content-Range: bytes */${stats.size}`);

            this.genLog(416, request, sock);
            sock.write(this.genHeaders(416, null, [
              `Content-Length: 0`
            ]));
          } else {
            let newHeaders = [];

            // Current selected range
            newHeaders.push(`Content-Range: bytes ${start}-${end}/${stats.size}`);
            newHeaders.push(`Content-Length: ${start === end ? 0 : (end - start + 1)}`);
            newHeaders.push(`Accept-Ranges: bytes`);
            newHeaders.push(`Cache-Control: no-cache`);

            let contents = fs.createReadStream(requestPath, { start: start, end: end });
            contents.on('open', () => {
              this.genLog(206, request, sock);
              sock.write(this.genHeaders(206, null, [
                `Last-Modified: ${moment(stats.mtime).tz("Africa/Bissau").format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`,
                `ETag: ${etag(stats)}`,
                `Content-Type: ${mime.contentType(path.extname(requestPath)) || 'application/octet-stream'}`,
                ...newHeaders
              ]));

              contents.pipe(sock);
            });
          }

        // Normal static files
        } else {
          let contents = fs.createReadStream(requestPath);
          contents.on('open', () => {
            this.genLog(200, request, sock);
            sock.write(this.genHeaders(200, null, [
              `Last-Modified: ${moment(stats.mtime).tz("Africa/Bissau").format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`,
              `ETag: ${etag(stats)}`,
              `Content-Type: ${mime.contentType(path.extname(requestPath)) || 'application/octet-stream'}`,
              `Content-Length: ${stats.size}`,
              'Cache-Control: public, max-age=0'
            ]));

            contents.pipe(sock);
          });
        }
      }
    }
  });
};

Lobabob.prototype.statusColor = function(status) {
  // Morgan colorscheme
  let color = status >= 500 ? 31 // red
     : status >= 400 ? 33 // yellow
     : status >= 300 ? 36 // cyan
     : status >= 200 ? 32 // green
     : 0; // no color
  return `\x1b[${color}m${status}\x1b[0m`;
};

// Extract proper range for partial content
Lobabob.prototype.readRangeHeader = function(range, totalLength) {
  if (range == null || range.length == 0)
    return null;

  var array = range.split(/bytes=([0-9]*)-([0-9]*)/);
  var start = parseInt(array[1]);
  var end = parseInt(array[2]);
  var result = {
    Start: isNaN(start) ? 0 : start,
    End: isNaN(end) ? (totalLength - 1) : end
  };
  
  if (!isNaN(start) && isNaN(end)) {
    result.Start = start;
    result.End = totalLength - 1;
  }

  if (isNaN(start) && !isNaN(end)) {
    result.Start = totalLength - end;
    result.End = totalLength - 1;
  }

  return result;
};

// Generate Apache style directory listing
Lobabob.prototype.genDirectoryListing = function(dir, request, cb) {
  let body = "";
  fs.readdir(dir, (err, files) => {
    if (err) cb(body);
    else {
      body = `<!DOCTYPE html>
        <html lang="en">
         <head>
          <title>Index of ${request}</title>
         </head>
         <body>
        <h1>Index of ${request}</h1>
        <ul>
        <li><a href="${path.dirname(request)}">..</li>
      `;
      files.forEach(file => {
        body += `<li><a href="${path.join(request, file)}">${file}</a></li>`;
      });
      body += `
        </ul>
        <address>Lobabob Server v${VERSION} Port ${this.get('port')}</address>
        </body></html>
      `;
      cb(body);
    }
  });
};

module.exports = function(options) {
  let lobabob = new Lobabob(options);
  return lobabob;
};
