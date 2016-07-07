/*
  Executes CGI scripts with proper environmental variables and returns the output.
*/
const spawn = require('child_process').spawn;

let options;

function CGI(requestPath, request) {
  this.requestPath = requestPath;
  this.request = request;
}

CGI.prototype.run = function(cb) {
  let output = "";
  let child = spawn(this.requestPath);

  child.stdout.on('data', data => {
    output += data;
  });

  child.stderr.on('data', (data) => {
    console.log(`stderr: ${data}`);
  });

  child.on('close', (code) => {
    cb(output);
  });
};

// Receive options
function init(ops) {
  options = ops;
}

module.exports = {
  init,
  create: CGI
};
