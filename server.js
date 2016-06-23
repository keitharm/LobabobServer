#!/usr/bin/env node
let argv = require('yargs').argv;

if (argv.help) {
  console.log(`
  Usage: lobabob [options]

  Options:

    -p, --port\t\tSpecify port Lobabob Server should run on. Default 1337
    -v, --debug\t\tOutput helpful debugging information. Default false
    -s, --static\tSpecify the static directory to serve files from. Overrides index setting. Default current directory.
    -d, --dir\t\tDirectory listing. Default false
    -i, --index\t\tSpecify index file. Default index.html
`);
  return;
}

const lobabob = require('./Lobabob')({
  port: argv.p || argv.port,
  debug: argv.v || argv.debug,
  static: argv.s || argv.static,
  showDir: argv.d || argv.dir,
  index: argv.i || argv.index,
});
lobabob.start();
