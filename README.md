# Lobabob Server
Turn any directory into a basic webserver.

`npm install lobabob -g`

  Usage: lobabob [options]

  Options:
    
    -p, --port    Specify port Lobabob Server should run on. Default 1337
    -v, --debug   Output helpful debugging information. Default false
    -s, --static  Specify the static directory to serve files from. Overrides index setting. Default current directory
    -c, --cgi     Specify the cgi-bin directory to serve executable scripts from. Default cgi-bin
    -d, --dir     Directory listing. Default false
    -i, --index   Specify index file. Default index.html
