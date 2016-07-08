/*
  Response generates the appropriate header response and status codes.
*/
const parse  = require('parse-headers');
const decode = require('urldecode');
const moment = require('moment-timezone');
const utils  = require('./utils');
const statusCodes = require('./statusCodes.json');
const fs = require('fs');

let options;

function Response() {
  this.body = null;
}

Response.prototype.genHeaders = function(extra = []) {
  // If we have a body and no stream
  if (this.body !== null && this.stream === undefined) {

    // Dirlist is in the body so the type is html
    if (this.type === "dirList") {
      extra.push(
        `Content-Type: text/html;charset=UTF-8`,
        `Content-Length: ${this.body.length}`
      );

    // Invalid range headers
    } else if (this.type === "invalidRange") {
      extra.push(
        `Content-Range: bytes */${this.size}`,
        `Content-Length: 0`
      );

    // CGI script
    } else if (this.type === "CGI") {
      extra.push(...this.headers);

    // else just assume normal plain text
    } else {
      extra.push(
        `Content-Type: text/plain;charset=UTF-8`,
        `Content-Length: ${this.body.length}`
      );
    }
    extra.push(`Cache-Control: no-cache`);

  // If we have a stream, mime type and size are in the response object
  } else if (this.stream !== undefined) {

    // Content-Rnage
    if (this.type === "validRange") {
      extra.push(
        `Content-Range: bytes ${this.size.start}-${this.size.end}/${this.size.total}`,
        `Content-Length: ${this.size.start === this.size.end ? 0 : (this.size.end - this.size.start + 1)}`,
        `Accept-Ranges: bytes`,
        `Cache-Control: no-cache`
      );

    // Send entire stream
    } else {
      extra.push(
        `Content-Type: ${this.mime}`,
        `Content-Length: ${this.size}`,
        `Cache-Control: public, max-age=0`
      );
    }
  }

  // Add etags for applicable files
  if (this.etag !== undefined) {
    extra.push(`ETag: ${this.etag}`);
  }

  // Combine all the headers together
  let headers = [
    `HTTP/1.1 ${this.code} ${statusCodes[this.code]}`,
    `Server: Lobabob v${utils.VERSION}`,
    `Date: ${moment(new Date().getTime()).format('ddd, D MMM YYYY HH:mm:ss [GMT]')}`,
    ...extra
  ];

  // Add appropriate body for error messages
  headers.push('');
  if (this.code === 404) {
    headers.push('The requested resource was not found.');
  } else if (this.code === 403) {
    headers.push('You do not have permission to access this resource.');
  } else if (this.code === 401) {
    headers.push('You are not authorized to access this resource.');
  } else if (this.code === 500) {
    headers.push('Internal Server Error');
  } else {
    headers.push('');
  }
  this.formattedHeaders = headers.join('\r\n');
};

Response.prototype.output = function() {
  this.genHeaders();
  let content = this.formattedHeaders;

  if (this.body !== null) {
    content += `${this.body}`;
  }
  return content;
};

Response.prototype.setStatus = function(code) { this.code = code };
Response.prototype.setHeaders = function(headers) { this.headers = headers };
Response.prototype.setBody = function(body) { this.body = body };
Response.prototype.setSize = function(size) { this.size = size };
Response.prototype.setMime = function(mime) { this.mime = mime };
Response.prototype.setEtag = function(etag) { this.etag = etag };
Response.prototype.setType = function(type) { this.type = type };
Response.prototype.setStream = function(path, cb) {

  // Partial range included 
  if (arguments.length === 3) {
    this.stream = fs.createReadStream(arguments[0], arguments[1]);
  } else {
    this.stream = fs.createReadStream(arguments[0]);
  }

  this.stream.on('open', () => {
    arguments[arguments.length-1]();
  });
};

// Receive options
function init(ops) {
  options = ops;
}

module.exports = {
  init,
  create: Response
};
