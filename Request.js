/*
  Request extracts the verb, path, and body information
  and also parses headers
*/
const parse  = require('parse-headers');
const decode = require('urldecode');
const cookie = require('cookie');

let options;

function Request(data) {
  this.data = data;
  this.parseHeaders();
}

Request.prototype.parseHeaders = function() {
  // Extract headers along with verb and path
  let resourceInfo = this.data.slice(0, this.data.indexOf('\r\n')).split(' ');
  this.headers = parse(this.data.slice(this.data.indexOf('\r\n')));

  this.verb = resourceInfo[0];
  this.rawPath = decode(resourceInfo[1]);
  this.queryString = {};
  this.cookies = this.headers.cookie || ""

  // Extract GET vars
  let getLoc = this.rawPath.indexOf('?');
  if (getLoc !== -1) {
    this.path = this.rawPath.slice(0, getLoc);
    this.queryString = this.rawPath.slice(getLoc + 1);
  } else {
    this.path = this.rawPath;
    this.queryString = "";
  }
};

// POST and PUT requests have bodies
Request.prototype.hasBody = function() {
  return this.verb === "POST" || this.verb === "PUT";
};



Request.prototype.setAddress = function(parts) {
  this.ip   = parts.ip;
  this.port = parts.port;
};

Request.prototype.setBody = function(body) {
  this.body = body;
};

Request.prototype.getIP = function() { return this.ip };
Request.prototype.getPort = function() { return this.port };
Request.prototype.getAddress = function() { return this.ip + ":" + this.port };
Request.prototype.getVerb = function() { return this.verb };
Request.prototype.getBody = function() { return this.body };
Request.prototype.getPath = function() { return this.path };
Request.prototype.getCookies = function() { return this.cookies };
Request.prototype.getQueryString = function() { return this.queryString };
Request.prototype.getHeaders = function() { return this.headers };
Request.prototype.getBodySize = function() { return Number(this.getHeaders()['content-length']) };
Request.prototype.getConnectionType = function() { return this.getHeaders()['connection'] || 'close' };

// Receive options
function init(ops) {
  options = ops;
}

module.exports = {
  init,
  create: Request
};
