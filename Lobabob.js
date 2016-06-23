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
const VERSION = "0.1";

function Lobabob(options) {
  this.options = options;
  this.setDefaults();
  this.set('static', path.resolve(this.get('static')));
  this.debug(this.options);
}

Lobabob.prototype.set = function(prop, val) {
  this.options[prop] = val;
};

Lobabob.prototype.get = function(prop, val) {
  return this.options[prop];
};

Lobabob.prototype.setDefaults = function() {
  let defaultOptions = {
    port:   1337,
    static: '', // default to current directory
    debug:  false,
    index:  'index.html',
    showDir: false
  };

  // Replace missing options with default values
  this.options = _.defaults(this.options, defaultOptions);
};

Lobabob.prototype.start = function() {
  var self = this;

  console.log(`Lobabob server listening on port ${this.get('port')}`);

  this.server = net.createServer(sock => {

    sock.on('data', data => {
      data = data.toString(); // Convert buffer

      // Extract headers along with verb and path
      let resourceInfo = data.slice(0, data.indexOf('\r\n')).split(' ');
      let headers = parse(data);

      let request = {
        verb: resourceInfo[0],
        path: decode(resourceInfo[1])
      };

      // Only allow GET requests for now
      if (request.verb !== 'GET') {
        self.genLog(405, request, sock);
        sock.end(self.genHeaders(405, null, ['Content-Length: 0']));
      } else {
        self.resourceHandler(headers, request, sock);
      }
    })

    sock.on('error', err => {
      self.debug(err);
    });

  }).listen(this.get('port'));
};

Lobabob.prototype.debug = function() {
  if (this.get('debug')) console.log.apply(null, arguments);
};

Lobabob.prototype.genHeaders = function(code, body, extra = []) {
  let headers = [
    `HTTP/1.1 ${code} ${statusCodes[code]}`,
    `Server: Lobabob v${VERSION}`,
    'Access-Control-Allow-Methods: GET',
    ...extra,
    'Connection: keep-alive'
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
  let self = this;
  let requestPath = path.join(this.get('static'), request.path);

  fs.stat(requestPath, (err, stats) => {
    // If this was a recursive call to check for the index file, remove it from the path
    if (request.dir) {
      request.path = request.path.slice(0, request.path.indexOf(self.get('index')));
    }

    if (err) {
      error(404);
    } else if (stats.isDirectory()) {
      if (self.get('showDir')) {
        self.genDirectoryListing(path.resolve(requestPath), path.resolve(request.path), body => {
          if (body === "") {
            error(500);
          } else {
            self.genLog(200, request, sock);
            sock.write(self.genHeaders(200, body, [
              `Content-Type: text/html;charset=UTF-8`,
              `Content-Length: ${body.length}`,
              'Cache-Control: no-cache',
              `Date: ${moment(new Date().getTime()).format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`
            ]));
          }
        });
      } else {
        request.path = path.join(request.path, self.get('index'));
        request.dir = true;
        self.resourceHandler(headers, request, sock);
      }
    } else {
      let oldetag = headers['if-none-match'];
      if (etag(stats) === oldetag) {
        self.genLog(304, request, sock);
        sock.write(self.genHeaders(304));
        sock.end();
      } else {

        // For streaming binary files
        if (headers.range !== undefined) {
          let rangeRequest = self.readRangeHeader(headers.range, stats.size);

          let start = rangeRequest.Start;
          let end   = rangeRequest.End;

          // If the range can't be fulfilled. 
          if (start >= stats.size || end >= stats.size) {
            // Indicate the acceptable range.
            newHeaders.push(`Content-Range: bytes */${stats.size}`);

            self.genLog(416, request, sock);
            sock.write(self.genHeaders(416, null, [
              `Content-Length: 0`,
              `Date: ${moment(new Date().getTime()).format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`
            ]));
          } else {
            let newHeaders = [];

            // Indicate the current range.
            newHeaders.push(`Content-Range: bytes ${start}-${end}/${stats.size}`);
            newHeaders.push(`Content-Length: ${start === end ? 0 : (end - start + 1)}`);
            newHeaders.push(`Accept-Ranges: bytes`);
            newHeaders.push(`Cache-Control: no-cache`);

            let contents = fs.createReadStream(requestPath, { start: start, end: end });
            contents.on('open', () => {
              self.genLog(206, request, sock);
              sock.write(self.genHeaders(206, null, [
                `Last-Modified: ${moment(stats.mtime).tz("Africa/Bissau").format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`,
                `ETag: ${etag(stats)}`,
                `Content-Type: ${mime.contentType(path.extname(requestPath)) || 'application/octet-stream'}`,
                `Date: ${moment(new Date().getTime()).format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`,
                ...newHeaders
              ]));
              contents.pipe(sock);
            });
          }

        // Normal static files
        } else {
          let contents = fs.createReadStream(requestPath);
          contents.on('open', () => {
            self.genLog(200, request, sock);
            sock.write(self.genHeaders(200, null, [
              `Last-Modified: ${moment(stats.mtime).tz("Africa/Bissau").format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`,
              `ETag: ${etag(stats)}`,
              `Content-Type: ${mime.contentType(path.extname(requestPath)) || 'application/octet-stream'}`,
              `Content-Length: ${stats.size}`,
              'Cache-Control: public, max-age=0',
              `Date: ${moment(new Date().getTime()).format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`
            ]));
            contents.pipe(sock);
          });
        }
      }
    }

    function error(code) {
      self.genLog(code, request, sock);
      sock.end(self.genHeaders(code));
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

Lobabob.prototype.genDirectoryListing = function(dir, request, cb) {
  let self = this;
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
        <address>Lobabob Server v${VERSION} Port ${self.get('port')}</address>
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
