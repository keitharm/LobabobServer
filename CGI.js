/*
  Executes CGI scripts with proper environmental variables and returns the output.
*/
const util  = require('util');
const parse = require('parse-headers');
const spawn = require('child_process').spawn;
const EventEmitter = require('events').EventEmitter;

let options;

function CGI(requestPath, request) {
  this.requestPath = requestPath;
  this.request = request;
}

util.inherits(CGI, EventEmitter);

CGI.prototype.run = function(cb) {
  this.output = "";
  let child = spawn(this.requestPath, [], {env: {
    "REQUEST_METHOD": this.request.getVerb(),
    "SCRIPT_FILENAME": this.requestPath,
    "SCRIPT_NAME": this.requestPath,
    "REQUEST_URI": this.requestPath,
    "CONTENT_TYPE": "",
    "CONTENT_LENGTH": "",
    "SERVER_PROTOCOL": "HTTP/1.1",
    "GATEWAY_INTERFACE": "CGI/1.1",
    "REMOTE_ADDR": this.request.getIP(),
    "REMOTE_PORT": this.request.getPort(),
    "REDIRECT_STATUS": 200,
    "DOCUMENT_ROOT": "/",
    "HTTP_COOKIE": this.request.getCookies(),
    "QUERY_STRING": this.request.getQueryString()
  }});

  child.stdout.on('data', data => {
    this.output += data;
  });

  child.stderr.on('data', (data) => {
    console.log(`stderr: ${data}`);
  });

  child.on('close', code => {
    this.code = code;
    this.extractHeaders();
  });
};

CGI.prototype.extractHeaders = function() {
  // No line breaks found so assume no headers and only body content
  if (this.output.indexOf('\r\n\r\n') === -1) {
    return this.emit('done', {status: 200, headers: [`Content-Length: ${this.output.length}`], body: this.output});
  }

  let rawHeaders    = this.output.slice(0, this.output.indexOf('\r\n\r\n'));
  let parsedHeaders = parse(rawHeaders);
  this.headers = rawHeaders.split('\r\n');

  if (parsedHeaders.status !== undefined) {
    this.status = parsedHeaders.status.slice(0, parsedHeaders.status.indexOf(' ')); // Extract status code
  } else {
    this.status = 200;
  }

  this.body = this.output.slice(this.output.indexOf('\r\n\r\n')+4);
  this.headers.push(`Content-Length: ${this.body.length}`)
  this.emit('done', {status: this.status, headers: this.headers, body: this.body});
};

// Receive options
function init(ops) {
  options = ops;
}

module.exports = {
  init,
  create: CGI
};
