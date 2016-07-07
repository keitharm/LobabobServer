const VERSION = "0.2";
const Promise = require('bluebird');
const path    = require('path');
const fs      = Promise.promisifyAll(require("fs"));

let options;

module.exports = {
  statusColor(status) {
    // Morgan colorscheme
    let color = status >= 500 ? 31 // red
       : status >= 400 ? 33 // yellow
       : status >= 300 ? 36 // cyan
       : status >= 200 ? 32 // green
       : 0; // no color
    return `\x1b[${color}m${status}\x1b[0m`;
  },
  readRangeHeader(range, totalLength) {
    if (range === null || range.length === 0)
      return null;

    let array = range.split(/bytes=([0-9]*)-([0-9]*)/);
    let start = parseInt(array[1]);
    let end = parseInt(array[2]);
    let result = {
      start: isNaN(start) ? 0 : start,
      end: isNaN(end) ? (totalLength - 1) : end
    };
    
    if (!isNaN(start) && isNaN(end)) {
      result.start = start;
      result.end = totalLength - 1;
    }

    if (isNaN(start) && !isNaN(end)) {
      result.start = totalLength - end;
      result.end = totalLength - 1;
    }

    return result;
  },
  genDirectoryListing(dir, request) {
    return new Promise((resolve, reject) => {
      let body = "";
      fs.readdirAsync(dir).then(files => {
        body = `<!DOCTYPE html>
          <html lang="en">
           <head>
            <title>Index of ${request}</title>
           </head>
           <body>
          <h1>Index of ${request}</h1>
          <ul>
          <li><a href="${path.dirname(request)}">..</a></li>
        `;
        files.forEach(file => {
          body += `<li><a href="${path.join(request, file)}">${file}</a></li>`;
        });
        body += `
          </ul>
          <address>Lobabob Server v${VERSION} Port ${options['port']}</address>
          </body></html>
        `;
        resolve(body);
      }, err => {
        reject(body);
      });
    });
  },
  init(ops) {
    options = ops;
  },
  debug() {
    if (options['debug']) console.log.apply(null, arguments);
  },
  genLog(code, request) {
    this.debug(request.getVerb() + " " + request.getPath() + " " + this.statusColor(code) + " " + request.getAddress());
  },
  defaults: {
    port:   3000,
    static: '', // default static to current directory
    cgibin: 'cgi-bin',
    debug:  false,
    index:  'index.html',
    showDir: false
  },
  VERSION
};
