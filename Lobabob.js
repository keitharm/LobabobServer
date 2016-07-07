const net   = require('net');
const path  = require('path');
const _     = require('lodash');

const Request  = require('./Request');
const Response = require('./Response');
const Handler  = require('./Handler');
const CGI      = require('./CGI');
const utils    = require('./utils');

function Lobabob(options) {
  this.options = options;
  this.setDefaults();

  // Directory to serve static files and cgi-bin scripts from
  this.set('static', path.resolve(this.get('static')));
  this.set('cgibin', path.resolve(this.get('cgibin')));

  // Send server options
  Request.init(this.options);
  Response.init(this.options);
  Handler.init(this.options);
  CGI.init(this.options);
  utils.init(this.options);

  utils.debug(this.options);
}

// Start listening and handling requests
Lobabob.prototype.start = function() {
  console.log(`Lobabob server listening on port ${this.get('port')}`);

  net.createServer(sock => {
    let buffer = "";

    // Make sure we don't keep creating a request object every time we receive data
    // after the headers are extracted
    let headersDone = false;
    let bodyDone    = false;

    sock.on('data', data => {
      let request, handler;
      buffer += data;

      // Find 1st occurance of two line breaks marking end of header data
      if (!headersDone && buffer.indexOf('\r\n\r\n') !== -1) {

        // Build Request object with initial header data
        request = new Request.create(buffer.slice(0, buffer.indexOf('\r\n\r\n')));

        // Remove headers from buffer
        buffer = buffer.slice(buffer.indexOf('\r\n\r\n') + 4);

        // Pass ip and port
        request.setAddress({ip: sock.remoteAddress, port: sock.remotePort});

        headersDone = true;
      }

      if (request && !bodyDone && request.hasBody()) {
        // // Have to check for chunked request here as well in the future
        // // Extract body if it is an appropriate request
        //request.moreData(); // Send the possibly chunked data to the request object

        request.setBody(buffer);
        bodyDone = true;

      // If the request verb doesn't expect a bodyDone
      } else {
        bodyDone = true;
      }

      // All done extracting/parsing headers and the body
      if (headersDone && bodyDone) {

        // Send completed request object to the handler
        handler = new Handler.create(request, request.getHeaders());
        handler.once('done', response => {
          // Pipe response directly to socket if it is a ReadStream
          if (response.stream !== undefined) {
            sock.write(response.output());
            response.stream.pipe(sock);

          // Else, just write to socket since body is included in response
          } else {
            sock.end(response.output());
          }
        });
      }
    });

    sock.on('error', err => {
      // Don't log errors from client terminating the connection
      if (err.code === "ECONNRESET" || err.code === "EPIPE") return;
      utils.debug(err.code);
    });

  }).listen(this.get('port'));
};

// Getters & Setters to interact with options
Lobabob.prototype.set = function(prop, val) {
  this.options[prop] = val;
};

Lobabob.prototype.get = function(prop, val) {
  return this.options[prop];
};

// Default settings
Lobabob.prototype.setDefaults = function() {
  // Replace missing options with default values
  this.options = _.defaults(this.options, utils.defaults);
};

module.exports = function(options) {
  let lobabob = new Lobabob(options);
  return lobabob;
};
