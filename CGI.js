/*
  Executes CGI scripts with proper environmental variables and returns the output.
*/
const util  = require('util');
const parse = require('parse-headers');
const spawn = require('child_process').spawn;
const EventEmitter = require('events').EventEmitter;
const os = require('os');

const utils = require('./utils');

let options;

function CGI(requestPath, request) {
  console.log(request);
  this.requestPath = requestPath;
  this.request = request;
}

util.inherits(CGI, EventEmitter);

CGI.prototype.run = function(cb) {
  this.output = "";
  let bodyLen = 0, bodyType = "";
  if (this.request.body !== undefined) {
    bodyType = this.request.headers['content-type'];
    bodyLen = this.request.body.length;
  }

  let child = spawn(this.requestPath, [], {env: {
    "DOCUMENT_ROOT": options['static'],
    "HTTP_COOKIE": this.request.getCookies(),
    "HTTP_HOST": os.hostname(),
    "HTTP_REFERER": this.request.headers.referer || '',
    "HTTP_USER_AGENT": this.request.headers['user-agent'],
    "SERVER_SOFTWARE": `Lobabob v${utils.VERSION}`,
    "REQUEST_METHOD": this.request.getVerb(),
    "SCRIPT_FILENAME": this.requestPath,
    "CONTENT_TYPE": bodyType,
    "CONTENT_LENGTH": bodyLen,
    "SERVER_PROTOCOL": "HTTP/1.1",
    "GATEWAY_INTERFACE": "CGI/1.1",
    "REMOTE_HOST": this.request.getIP(),
    "REMOTE_ADDR": this.request.getIP(),
    "REMOTE_PORT": this.request.getPort(),
    "REDIRECT_STATUS": 200,
    "QUERY_STRING": this.request.getQueryString()
  }});

  if (this.request.body !== undefined) {
    child.stdin.write(this.request.body);
  }

  child.stdout.on('data', data => {
    this.output += data;
  });

  child.stderr.on('data', (data) => {
    //console.log(`stderr: ${data}`);
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
