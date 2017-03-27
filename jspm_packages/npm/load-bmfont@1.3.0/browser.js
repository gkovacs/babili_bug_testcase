/* */ 
(function(Buffer) {
  var xhr = require('xhr');
  var noop = function() {};
  var parseASCII = require('parse-bmfont-ascii');
  var parseXML = require('parse-bmfont-xml');
  var readBinary = require('parse-bmfont-binary');
  var isBinaryFormat = require('./lib/is-binary');
  var xtend = require('xtend');
  var xml2 = (function hasXML2() {
    return self.XMLHttpRequest && "withCredentials" in new XMLHttpRequest;
  })();
  module.exports = function(opt, cb) {
    cb = typeof cb === 'function' ? cb : noop;
    if (typeof opt === 'string')
      opt = {uri: opt};
    else if (!opt)
      opt = {};
    var expectBinary = opt.binary;
    if (expectBinary)
      opt = getBinaryOpts(opt);
    xhr(opt, function(err, res, body) {
      if (err)
        return cb(err);
      if (!/^2/.test(res.statusCode))
        return cb(new Error('http status code: ' + res.statusCode));
      if (!body)
        return cb(new Error('no body result'));
      var binary = false;
      if (isArrayBuffer(body)) {
        var array = new Uint8Array(body);
        body = new Buffer(array, 'binary');
      }
      if (isBinaryFormat(body)) {
        binary = true;
        if (typeof body === 'string')
          body = new Buffer(body, 'binary');
      }
      if (!binary) {
        if (Buffer.isBuffer(body))
          body = body.toString(opt.encoding);
        body = body.trim();
      }
      var result;
      try {
        var type = res.headers['content-type'];
        if (binary)
          result = readBinary(body);
        else if (/json/.test(type) || body.charAt(0) === '{')
          result = JSON.parse(body);
        else if (/xml/.test(type) || body.charAt(0) === '<')
          result = parseXML(body);
        else
          result = parseASCII(body);
      } catch (e) {
        cb(new Error('error parsing font ' + e.message));
        cb = noop;
      }
      cb(null, result);
    });
  };
  function isArrayBuffer(arr) {
    var str = Object.prototype.toString;
    return str.call(arr) === '[object ArrayBuffer]';
  }
  function getBinaryOpts(opt) {
    if (xml2)
      return xtend(opt, {responseType: 'arraybuffer'});
    if (typeof self.XMLHttpRequest === 'undefined')
      throw new Error('your browser does not support XHR loading');
    var req = new self.XMLHttpRequest();
    req.overrideMimeType('text/plain; charset=x-user-defined');
    return xtend({xhr: req}, opt);
  }
})(require('buffer').Buffer);
