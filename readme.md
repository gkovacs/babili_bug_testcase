# testcase for reproducing babili issue 458

https://github.com/babel/babili/issues/458

# Reproducing the bug

Clone this repo and start a webserver:

```
npm install -g http-server
http-server
```

Then visit http://localhost:8080

Look at the console output. You will see it correctly imported icojs.

Now replace build.js with the version minified by babili (I have the output at build.min.js)

Now icojs will no longer import.
