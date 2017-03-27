/* */ 
(function(Buffer, process) {
  var PNG = require('pngjs').PNG;
  var JPEG = require('jpeg-js');
  var BMP = require('bmp-js');
  var MIME = require('mime');
  var TinyColor = require('tinycolor2');
  var Resize = require('./resize');
  var Resize2 = require('./resize2');
  var StreamToBuffer = require('stream-to-buffer');
  var ReadChunk = require('read-chunk');
  var FileType = require('file-type');
  var PixelMatch = require('pixelmatch');
  var EXIFParser = require('exif-parser');
  var ImagePHash = require('./phash');
  var BigNumber = require('bignumber.js');
  var URLRegEx = require('url-regex');
  var BMFont = require('load-bmfont');
  var Path = require('path');
  var chars = 0;
  function log(msg) {
    clear();
    chars = msg.length;
  }
  function clear() {}
  function noop() {}
  ;
  function isNodePattern(cb) {
    if ("undefined" == typeof cb)
      return false;
    if ("function" != typeof cb)
      throw new Error("Callback must be a function");
    return true;
  }
  function throwError(error, cb) {
    if ("string" == typeof error)
      error = new Error(error);
    if ("function" == typeof cb)
      return cb.call(this, error);
    else
      throw error;
  }
  function Jimp() {
    if ("number" == typeof arguments[0] && "number" == typeof arguments[1]) {
      var w = arguments[0];
      var h = arguments[1];
      var cb = arguments[2];
      if ("number" == typeof arguments[2]) {
        this._background = arguments[2];
        var cb = arguments[3];
      }
      if ("undefined" == typeof cb)
        cb = noop;
      if ("function" != typeof cb)
        return throwError.call(this, "cb must be a function", cb);
      this.bitmap = {
        data: new Buffer(w * h * 4),
        width: w,
        height: h
      };
      for (var i = 0; i < this.bitmap.data.length; i = i + 4) {
        this.bitmap.data.writeUInt32BE(this._background, i);
      }
      cb.call(this, null, this);
    } else if ("object" == typeof arguments[0] && arguments[0].constructor == Jimp) {
      var original = arguments[0];
      var cb = arguments[1];
      if ("undefined" == typeof cb)
        cb = noop;
      if ("function" != typeof cb)
        return throwError.call(this, "cb must be a function", cb);
      var bitmap = new Buffer(original.bitmap.data.length);
      original.scan(0, 0, original.bitmap.width, original.bitmap.height, function(x, y, idx) {
        var data = original.bitmap.data.readUInt32BE(idx, true);
        bitmap.writeUInt32BE(data, idx, true);
      });
      this.bitmap = {
        data: bitmap,
        width: original.bitmap.width,
        height: original.bitmap.height
      };
      this._quality = original._quality;
      this._deflateLevel = original._deflateLevel;
      this._deflateStrategy = original._deflateStrategy;
      this._filterType = original._filterType;
      this._rgba = original._rgba;
      this._background = original._background;
      cb.call(this, null, this);
    } else if (URLRegEx({exact: true}).test(arguments[0])) {
      var url = arguments[0];
      var cb = arguments[1];
      if ("undefined" == typeof cb)
        cb = noop;
      if ("function" != typeof cb)
        return throwError.call(this, "cb must be a function", cb);
      var that = this;
      Request(url, function(err, response, data) {
        if (err)
          return throwError.call(that, err, cb);
        if ("object" == typeof data && Buffer.isBuffer(data)) {
          var mime = getMIMEFromBuffer(data);
          if ("string" != typeof mime)
            return throwError.call(that, "Could not find MIME for Buffer <" + url + "> (HTTP: " + response.statusCode + ")", cb);
          parseBitmap.call(that, data, mime, cb);
        } else
          return throwError.call(that, "Could not load Buffer from URL <" + url + "> (HTTP: " + response.statusCode + ")", cb);
      });
    } else if ("string" == typeof arguments[0]) {
      var path = arguments[0];
      var cb = arguments[1];
      if ("undefined" == typeof cb)
        cb = noop;
      if ("function" != typeof cb)
        return throwError.call(this, "cb must be a function", cb);
      var that = this;
      getMIMEFromPath(path, function(err, mime) {
        FS.readFile(path, function(err, data) {
          if (err)
            return throwError.call(that, err, cb);
          parseBitmap.call(that, data, mime, cb);
        });
      });
    } else if ("object" == typeof arguments[0]) {
      var data = arguments[0];
      var mime = getMIMEFromBuffer(data);
      var cb = arguments[1];
      if (!Buffer.isBuffer(data))
        return throwError.call(this, "data must be a Buffer", cb);
      if ("string" != typeof mime)
        return throwError.call(this, "mime must be a string", cb);
      if ("function" != typeof cb)
        return throwError.call(this, "cb must be a function", cb);
      parseBitmap.call(this, data, mime, cb);
    } else {
      return throwError.call(this, "No matching constructor overloading was found. Please see the docs for how to call the Jimp constructor.", cb);
    }
  }
  Jimp.read = function(src, cb) {
    var promise = new Promise(function(resolve, reject) {
      cb = cb || function(err, image) {
        if (err)
          reject(err);
        else
          resolve(image);
      };
      if ("string" != typeof src && ("object" != typeof src || !Buffer.isBuffer(src)))
        return throwError.call(this, "src must be a string or a Buffer", cb);
      var img = new Jimp(src, cb);
    });
    return promise;
  };
  function getMIMEFromBuffer(buffer, path) {
    var fileTypeFromBuffer = FileType(buffer);
    if (fileTypeFromBuffer) {
      return fileTypeFromBuffer.mime;
    } else if (path) {
      return MIME.lookup(path);
    } else {
      return null;
    }
  }
  function getMIMEFromPath(path, cb) {
    ReadChunk(path, 0, 262, function(err, buffer) {
      if (err) {
        cb(null, "");
      } else {
        var fileType = FileType(buffer);
        return cb && cb(null, fileType && fileType.mime || "");
      }
    });
  }
  function parseBitmap(data, mime, cb) {
    var that = this;
    this._originalMime = mime.toLowerCase();
    switch (this.getMIME()) {
      case Jimp.MIME_PNG:
        var png = new PNG();
        png.parse(data, function(err, data) {
          if (err)
            return throwError.call(that, err, cb);
          that.bitmap = {
            data: new Buffer(data.data),
            width: data.width,
            height: data.height
          };
          return cb.call(that, null, that);
        });
        break;
      case Jimp.MIME_JPEG:
        try {
          this.bitmap = JPEG.decode(data);
          exifRotate(this, data);
          return cb.call(this, null, this);
        } catch (err) {
          return cb.call(this, err, this);
        }
      case Jimp.MIME_BMP:
        this.bitmap = BMP.decode(data);
        return cb.call(this, null, this);
      default:
        return throwError.call(this, "Unsupported MIME type: " + mime, cb);
    }
  }
  function exifRotate(image, buffer) {
    var exif;
    try {
      exif = EXIFParser.create(buffer).parse();
    } catch (err) {
      return;
    }
    if (!exif || !exif.tags || !exif.tags.Orientation)
      return;
    switch (exif.tags.Orientation) {
      case 1:
        break;
      case 2:
        image.mirror(true, false);
        break;
      case 3:
        image.rotate(180);
        break;
      case 4:
        image.mirror(false, true);
        break;
      case 5:
        image.mirror(true, false).rotate(270);
        break;
      case 6:
        image.rotate(90);
        break;
      case 7:
        image.mirror(true, false).rotate(90);
        break;
      case 8:
        image.rotate(270);
        break;
    }
  }
  Jimp.AUTO = -1;
  Jimp.MIME_PNG = "image/png";
  Jimp.MIME_JPEG = "image/jpeg";
  Jimp.MIME_BMP = "image/bmp";
  Jimp.PNG_FILTER_AUTO = -1;
  Jimp.PNG_FILTER_NONE = 0;
  Jimp.PNG_FILTER_SUB = 1;
  Jimp.PNG_FILTER_UP = 2;
  Jimp.PNG_FILTER_AVERAGE = 3;
  Jimp.PNG_FILTER_PAETH = 4;
  Jimp.RESIZE_NEAREST_NEIGHBOR = 'nearestNeighbor';
  Jimp.RESIZE_BILINEAR = 'bilinearInterpolation';
  Jimp.RESIZE_BICUBIC = 'bicubicInterpolation';
  Jimp.RESIZE_HERMITE = 'hermiteInterpolation';
  Jimp.RESIZE_BEZIER = 'bezierInterpolation';
  Jimp.HORIZONTAL_ALIGN_LEFT = 1;
  Jimp.HORIZONTAL_ALIGN_CENTER = 2;
  Jimp.HORIZONTAL_ALIGN_RIGHT = 4;
  Jimp.VERTICAL_ALIGN_TOP = 8;
  Jimp.VERTICAL_ALIGN_MIDDLE = 16;
  Jimp.VERTICAL_ALIGN_BOTTOM = 32;
  Jimp.EDGE_EXTEND = 1;
  Jimp.EDGE_WRAP = 2;
  Jimp.EDGE_CROP = 3;
  Jimp.rgbaToInt = function(r, g, b, a, cb) {
    if ("number" != typeof r || "number" != typeof g || "number" != typeof b || "number" != typeof a)
      return throwError.call(this, "r, g, b and a must be numbers", cb);
    if (r < 0 || r > 255)
      return throwError.call(this, "r must be between 0 and 255", cb);
    if (g < 0 || g > 255)
      throwError.call(this, "g must be between 0 and 255", cb);
    if (b < 0 || b > 255)
      return throwError.call(this, "b must be between 0 and 255", cb);
    if (a < 0 || a > 255)
      return throwError.call(this, "a must be between 0 and 255", cb);
    var i = (r * Math.pow(256, 3)) + (g * Math.pow(256, 2)) + (b * Math.pow(256, 1)) + (a * Math.pow(256, 0));
    if (isNodePattern(cb))
      return cb.call(this, null, i);
    else
      return i;
  };
  Jimp.intToRGBA = function(i, cb) {
    if ("number" != typeof i)
      return throwError.call(this, "i must be a number", cb);
    var rgba = {};
    rgba.r = Math.floor(i / Math.pow(256, 3));
    rgba.g = Math.floor((i - (rgba.r * Math.pow(256, 3))) / Math.pow(256, 2));
    rgba.b = Math.floor((i - (rgba.r * Math.pow(256, 3)) - (rgba.g * Math.pow(256, 2))) / Math.pow(256, 1));
    rgba.a = Math.floor((i - (rgba.r * Math.pow(256, 3)) - (rgba.g * Math.pow(256, 2)) - (rgba.b * Math.pow(256, 1))) / Math.pow(256, 0));
    if (isNodePattern(cb))
      return cb.call(this, null, rgba);
    else
      return rgba;
  };
  Jimp.limit255 = function(n) {
    n = Math.max(n, 0);
    n = Math.min(n, 255);
    return n;
  };
  Jimp.diff = function(img1, img2, threshold) {
    if ("object" != typeof img1 || img1.constructor != Jimp || "object" != typeof img2 || img2.constructor != Jimp)
      return throwError.call(this, "img1 and img2 must be an Jimp images");
    if (img1.bitmap.width != img2.bitmap.width || img1.bitmap.height != img2.bitmap.height) {
      switch (img1.bitmap.width * img1.bitmap.height > img2.bitmap.width * img2.bitmap.height) {
        case true:
          img1 = img1.clone().resize(img2.bitmap.width, img2.bitmap.height);
          break;
        default:
          img2 = img2.clone().resize(img1.bitmap.width, img1.bitmap.height);
          break;
      }
    }
    threshold = threshold || 0.1;
    if ("number" != typeof threshold || threshold < 0 || threshold > 1)
      return throwError.call(this, "threshold must be a number between 0 and 1");
    var diff = new Jimp(img1.bitmap.width, img1.bitmap.height, 0xFFFFFFFF);
    var numDiffPixels = PixelMatch(img1.bitmap.data, img2.bitmap.data, diff.bitmap.data, diff.bitmap.width, diff.bitmap.height, {threshold: threshold});
    return {
      percent: numDiffPixels / (diff.bitmap.width * diff.bitmap.height),
      image: diff
    };
  };
  Jimp.distance = function(img1, img2) {
    var phash = new ImagePHash();
    var hash1 = phash.getHash(img1);
    var hash2 = phash.getHash(img2);
    return phash.distance(hash1, hash2);
  };
  Jimp.prototype.bitmap = {
    data: null,
    width: null,
    height: null
  };
  Jimp.prototype._quality = 100;
  Jimp.prototype._deflateLevel = 9;
  Jimp.prototype._deflateStrategy = 3;
  Jimp.prototype._filterType = Jimp.PNG_FILTER_AUTO;
  Jimp.prototype._rgba = true;
  Jimp.prototype._background = 0x00000000;
  Jimp.prototype._originalMime = Jimp.MIME_PNG;
  Jimp.prototype.clone = function(cb) {
    var clone = new Jimp(this);
    if (isNodePattern(cb))
      return cb.call(clone, null, clone);
    else
      return clone;
  };
  Jimp.prototype.quality = function(n, cb) {
    if ("number" != typeof n)
      return throwError.call(this, "n must be a number", cb);
    if (n < 0 || n > 100)
      return throwError.call(this, "n must be a number 0 - 100", cb);
    this._quality = Math.round(n);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.deflateLevel = function(l, cb) {
    if ("number" != typeof l)
      return throwError.call(this, "l must be a number", cb);
    if (l < 0 || l > 9)
      return throwError.call(this, "l must be a number 0 - 9", cb);
    this._deflateLevel = Math.round(l);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.deflateStrategy = function(s, cb) {
    if ("number" != typeof s)
      return throwError.call(this, "s must be a number", cb);
    if (s < 0 || s > 3)
      return throwError.call(this, "s must be a number 0 - 3", cb);
    this._deflateStrategy = Math.round(s);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.filterType = function(f, cb) {
    if ("number" != typeof f)
      return throwError.call(this, "n must be a number", cb);
    if (f < -1 || f > 4)
      return throwError.call(this, "n must be -1 (auto) or a number 0 - 4", cb);
    this._filterType = Math.round(f);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.rgba = function(bool, cb) {
    if ("boolean" != typeof bool)
      return throwError.call(this, "bool must be a boolean, true for RGBA or false for RGB", cb);
    this._rgba = bool;
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.background = function(hex, cb) {
    if ("number" != typeof hex)
      return throwError.call(this, "hex must be a hexadecimal rgba value", cb);
    this._background = hex;
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.scan = function(x, y, w, h, f, cb) {
    if ("number" != typeof x || "number" != typeof y)
      return throwError.call(this, "x and y must be numbers", cb);
    if ("number" != typeof w || "number" != typeof h)
      return throwError.call(this, "w and h must be numbers", cb);
    if ("function" != typeof f)
      return throwError.call(this, "f must be a function", cb);
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
    for (var _y = y; _y < (y + h); _y++) {
      for (var _x = x; _x < (x + w); _x++) {
        var idx = (this.bitmap.width * _y + _x) << 2;
        f.call(this, _x, _y, idx);
      }
    }
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.getMIME = function() {
    var mime = this._originalMime || Jimp.MIME_PNG;
    return mime;
  };
  Jimp.prototype.getExtension = function() {
    var mime = this.getMIME();
    return MIME.extension(mime);
  };
  Jimp.prototype.getPixelIndex = function(x, y, edgeHandling, cb) {
    var xi,
        yi;
    if ("function" == typeof edgeHandling && "undefined" == typeof cb) {
      cb = edgeHandling;
      edgeHandling = null;
    }
    if (!edgeHandling)
      edgeHandling = Jimp.EDGE_EXTEND;
    if ("number" != typeof x || "number" != typeof y)
      return throwError.call(this, "x and y must be numbers", cb);
    xi = x = Math.round(x);
    yi = y = Math.round(y);
    if (edgeHandling = Jimp.EDGE_EXTEND) {
      if (x < 0)
        xi = 0;
      if (x >= this.bitmap.width)
        xi = this.bitmap.width - 1;
      if (y < 0)
        yi = 0;
      if (y >= this.bitmap.height)
        yi = this.bitmap.height - 1;
    }
    if (edgeHandling = Jimp.EDGE_WRAP) {
      if (x < 0)
        xi = this.bitmap.width + x;
      if (x >= this.bitmap.width)
        xi = x % this.bitmap.width;
      if (y < 0)
        xi = this.bitmap.height + y;
      if (y >= this.bitmap.height)
        yi = y % this.bitmap.height;
    }
    var i = (this.bitmap.width * yi + xi) << 2;
    if (xi < 0 || xi >= this.bitmap.width)
      i = -1;
    if (yi < 0 || yi >= this.bitmap.height)
      i = -1;
    if (isNodePattern(cb))
      return cb.call(this, null, i);
    else
      return i;
  };
  Jimp.prototype.getPixelColor = Jimp.prototype.getPixelColour = function(x, y, cb) {
    if ("number" != typeof x || "number" != typeof y)
      return throwError.call(this, "x and y must be numbers", cb);
    x = Math.round(x);
    y = Math.round(y);
    var idx = this.getPixelIndex(x, y);
    var hex = this.bitmap.data.readUInt32BE(idx);
    if (isNodePattern(cb))
      return cb.call(this, null, hex);
    else
      return hex;
  };
  Jimp.prototype.setPixelColor = Jimp.prototype.setPixelColour = function(hex, x, y, cb) {
    if ("number" != typeof hex || "number" != typeof x || "number" != typeof y)
      return throwError.call(this, "hex, x and y must be numbers", cb);
    x = Math.round(x);
    y = Math.round(y);
    var idx = this.getPixelIndex(x, y);
    this.bitmap.data.writeUInt32BE(hex, idx, true);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  var maxHashLength = [];
  for (var i = 0; i < 65; i++) {
    var l = (i > 1) ? (new BigNumber(Array(64 + 1).join("1"), 2)).toString(i) : NaN;
    maxHashLength.push(l.length);
  }
  Jimp.prototype.hash = function(base, cb) {
    base = base || 64;
    if ("function" == typeof base) {
      cb = base;
      base = 64;
    }
    if ("number" != typeof base)
      return throwError.call(this, "base must be a number", cb);
    if (base < 2 || base > 64)
      return throwError.call(this, "base must be a number between 2 and 64", cb);
    var hash = (new ImagePHash()).getHash(this);
    hash = (new BigNumber(hash, 2)).toString(base);
    while (hash.length < maxHashLength[base]) {
      hash = "0" + hash;
    }
    if (isNodePattern(cb))
      return cb.call(this, null, hash);
    else
      return hash;
  };
  Jimp.prototype.crop = function(x, y, w, h, cb) {
    if ("number" != typeof x || "number" != typeof y)
      return throwError.call(this, "x and y must be numbers", cb);
    if ("number" != typeof w || "number" != typeof h)
      return throwError.call(this, "w and h must be numbers", cb);
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
    var bitmap = new Buffer(this.bitmap.data.length);
    var offset = 0;
    this.scan(x, y, w, h, function(x, y, idx) {
      var data = this.bitmap.data.readUInt32BE(idx, true);
      bitmap.writeUInt32BE(data, offset, true);
      offset += 4;
    });
    this.bitmap.data = new Buffer(bitmap);
    this.bitmap.width = w;
    this.bitmap.height = h;
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.autocrop = function() {
    var w = this.bitmap.width;
    var h = this.bitmap.height;
    var minPixelsPerSide = 1;
    var cb;
    var tolerance = 0.0002;
    var cropOnlyFrames = true;
    for (var a = 0,
        len = arguments.length; a < len; a++) {
      if ("number" == typeof arguments[a]) {
        tolerance = arguments[a];
      }
      if ("boolean" == typeof arguments[a]) {
        cropOnlyFrames = arguments[a];
      }
      if ("function" == typeof arguments[a]) {
        cb = arguments[a];
      }
    }
    var colorTarget = this.getPixelColor(0, 0);
    var northPixelsToCrop = 0;
    var eastPixelsToCrop = 0;
    var southPixelsToCrop = 0;
    var westPixelsToCrop = 0;
    var rgba1 = Jimp.intToRGBA(colorTarget);
    north: for (var y = 0; y < h - minPixelsPerSide; y++) {
      for (var x = 0; x < w; x++) {
        var colorXY = this.getPixelColor(x, y);
        var rgba2 = Jimp.intToRGBA(colorXY);
        var difference = Math.abs(Math.max((rgba1.r - rgba2.r) ^ 2, (rgba1.r - rgba2.r - rgba1.a + rgba2.a) ^ 2) + Math.max((rgba1.g - rgba2.g) ^ 2, (rgba1.g - rgba2.g - rgba1.a + rgba2.a) ^ 2) + Math.max((rgba1.b - rgba2.b) ^ 2, (rgba1.b - rgba2.b - rgba1.a + rgba2.a) ^ 2)) / (256 * 256 * 3);
        if (difference > tolerance) {
          break north;
        }
      }
      northPixelsToCrop++;
    }
    east: for (var x = 0; x < w - minPixelsPerSide; x++) {
      for (var y = 0 + northPixelsToCrop; y < h; y++) {
        var colorXY = this.getPixelColor(x, y);
        var rgba2 = Jimp.intToRGBA(colorXY);
        var difference = Math.abs(Math.max((rgba1.r - rgba2.r) ^ 2, (rgba1.r - rgba2.r - rgba1.a + rgba2.a) ^ 2) + Math.max((rgba1.g - rgba2.g) ^ 2, (rgba1.g - rgba2.g - rgba1.a + rgba2.a) ^ 2) + Math.max((rgba1.b - rgba2.b) ^ 2, (rgba1.b - rgba2.b - rgba1.a + rgba2.a) ^ 2)) / (256 * 256 * 3);
        if (difference > tolerance) {
          break east;
        }
      }
      eastPixelsToCrop++;
    }
    colorTarget = this.getPixelColor(w - 1, h - 1);
    south: for (var y = h - 1; y >= 0 + northPixelsToCrop + minPixelsPerSide; y--) {
      for (var x = w - eastPixelsToCrop - 1; x >= 0; x--) {
        var colorXY = this.getPixelColor(x, y);
        var rgba2 = Jimp.intToRGBA(colorXY);
        var difference = Math.abs(Math.max((rgba1.r - rgba2.r) ^ 2, (rgba1.r - rgba2.r - rgba1.a + rgba2.a) ^ 2) + Math.max((rgba1.g - rgba2.g) ^ 2, (rgba1.g - rgba2.g - rgba1.a + rgba2.a) ^ 2) + Math.max((rgba1.b - rgba2.b) ^ 2, (rgba1.b - rgba2.b - rgba1.a + rgba2.a) ^ 2)) / (256 * 256 * 3);
        if (difference > tolerance) {
          break south;
        }
      }
      southPixelsToCrop++;
    }
    west: for (var x = w - 1; x >= 0 + eastPixelsToCrop + minPixelsPerSide; x--) {
      for (var y = h - 1; y >= 0 + northPixelsToCrop; y--) {
        var colorXY = this.getPixelColor(x, y);
        var rgba2 = Jimp.intToRGBA(colorXY);
        var difference = Math.abs(Math.max((rgba1.r - rgba2.r) ^ 2, (rgba1.r - rgba2.r - rgba1.a + rgba2.a) ^ 2) + Math.max((rgba1.g - rgba2.g) ^ 2, (rgba1.g - rgba2.g - rgba1.a + rgba2.a) ^ 2) + Math.max((rgba1.b - rgba2.b) ^ 2, (rgba1.b - rgba2.b - rgba1.a + rgba2.a) ^ 2)) / (256 * 256 * 3);
        if (difference > tolerance) {
          break west;
        }
      }
      westPixelsToCrop++;
    }
    var widthOfPixelsToCrop = w - (westPixelsToCrop + eastPixelsToCrop);
    widthOfPixelsToCrop >= 0 ? widthOfPixelsToCrop : 0;
    var heightOfPixelsToCrop = h - (southPixelsToCrop + northPixelsToCrop);
    heightOfPixelsToCrop >= 0 ? heightOfPixelsToCrop : 0;
    var doCrop = false;
    if (cropOnlyFrames) {
      doCrop = (eastPixelsToCrop !== 0 && northPixelsToCrop !== 0 && westPixelsToCrop !== 0 && southPixelsToCrop !== 0);
    } else {
      doCrop = (eastPixelsToCrop !== 0 || northPixelsToCrop !== 0 || westPixelsToCrop !== 0 || southPixelsToCrop !== 0);
    }
    if (doCrop) {
      this.crop(eastPixelsToCrop, northPixelsToCrop, widthOfPixelsToCrop, heightOfPixelsToCrop);
    }
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.blit = function(src, x, y, srcx, srcy, srcw, srch, cb) {
    if ("object" != typeof src || src.constructor != Jimp)
      return throwError.call(this, "The source must be a Jimp image", cb);
    if ("number" != typeof x || "number" != typeof y)
      return throwError.call(this, "x and y must be numbers", cb);
    if ("function" == typeof srcx) {
      cb = srcx;
      srcx = 0;
      srcy = 0;
      srcw = src.bitmap.width;
      srch = src.bitmap.height;
    } else if (typeof srcx == typeof srcy && typeof srcy == typeof srcw && typeof srcw == typeof srch) {
      srcx = srcx || 0;
      srcy = srcy || 0;
      srcw = srcw || src.bitmap.width;
      srch = srch || src.bitmap.height;
    } else {
      return throwError.call(this, "srcx, srcy, srcw, srch must be numbers", cb);
    }
    x = Math.round(x);
    y = Math.round(y);
    srcx = Math.round(srcx);
    srcy = Math.round(srcy);
    srcw = Math.round(srcw);
    srch = Math.round(srch);
    var that = this;
    src.scan(srcx, srcy, srcw, srch, function(sx, sy, idx) {
      var dstIdx = that.getPixelIndex(x + sx - srcx, y + sy - srcy);
      that.bitmap.data[dstIdx] = this.bitmap.data[idx];
      that.bitmap.data[dstIdx + 1] = this.bitmap.data[idx + 1];
      that.bitmap.data[dstIdx + 2] = this.bitmap.data[idx + 2];
      that.bitmap.data[dstIdx + 3] = this.bitmap.data[idx + 3];
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.mask = function(src, x, y, cb) {
    if ("object" != typeof src || src.constructor != Jimp)
      return throwError.call(this, "The source must be a Jimp image", cb);
    if ("number" != typeof x || "number" != typeof y)
      return throwError.call(this, "x and y must be numbers", cb);
    x = Math.round(x);
    y = Math.round(y);
    var that = this;
    src.scan(0, 0, src.bitmap.width, src.bitmap.height, function(sx, sy, idx) {
      var dstIdx = that.getPixelIndex(x + sx, y + sy);
      var avg = (this.bitmap.data[idx + 0] + this.bitmap.data[idx + 1] + this.bitmap.data[idx + 2]) / 3;
      that.bitmap.data[dstIdx + 3] *= avg / 255;
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.composite = function(src, x, y, cb) {
    if ("object" != typeof src || src.constructor != Jimp)
      return throwError.call(this, "The source must be a Jimp image", cb);
    if ("number" != typeof x || "number" != typeof y)
      return throwError.call(this, "x and y must be numbers", cb);
    x = Math.round(x);
    y = Math.round(y);
    var that = this;
    src.scan(0, 0, src.bitmap.width, src.bitmap.height, function(sx, sy, idx) {
      var dstIdx = that.getPixelIndex(x + sx, y + sy);
      var fg = {
        r: this.bitmap.data[idx + 0] / 255,
        g: this.bitmap.data[idx + 1] / 255,
        b: this.bitmap.data[idx + 2] / 255,
        a: this.bitmap.data[idx + 3] / 255
      };
      var bg = {
        r: that.bitmap.data[dstIdx + 0] / 255,
        g: that.bitmap.data[dstIdx + 1] / 255,
        b: that.bitmap.data[dstIdx + 2] / 255,
        a: that.bitmap.data[dstIdx + 3] / 255
      };
      var a = bg.a + fg.a - bg.a * fg.a;
      var r = ((fg.r * fg.a) + (bg.r * bg.a) * (1 - fg.a)) / a;
      var g = ((fg.g * fg.a) + (bg.g * bg.a) * (1 - fg.a)) / a;
      var b = ((fg.b * fg.a) + (bg.b * bg.a) * (1 - fg.a)) / a;
      that.bitmap.data[dstIdx + 0] = Jimp.limit255(r * 255);
      that.bitmap.data[dstIdx + 1] = Jimp.limit255(g * 255);
      that.bitmap.data[dstIdx + 2] = Jimp.limit255(b * 255);
      that.bitmap.data[dstIdx + 3] = Jimp.limit255(a * 255);
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.brightness = function(val, cb) {
    if ("number" != typeof val)
      return throwError.call(this, "val must be numbers", cb);
    if (val < -1 || val > +1)
      return throwError.call(this, "val must be a number between -1 and +1", cb);
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      if (val < 0.0) {
        this.bitmap.data[idx] = this.bitmap.data[idx] * (1 + val);
        this.bitmap.data[idx + 1] = this.bitmap.data[idx + 1] * (1 + val);
        this.bitmap.data[idx + 2] = this.bitmap.data[idx + 2] * (1 + val);
      } else {
        this.bitmap.data[idx] = this.bitmap.data[idx] + ((255 - this.bitmap.data[idx]) * val);
        this.bitmap.data[idx + 1] = this.bitmap.data[idx + 1] + ((255 - this.bitmap.data[idx + 1]) * val);
        this.bitmap.data[idx + 2] = this.bitmap.data[idx + 2] + ((255 - this.bitmap.data[idx + 2]) * val);
      }
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.contrast = function(val, cb) {
    if ("number" != typeof val)
      return throwError.call(this, "val must be numbers", cb);
    if (val < -1 || val > +1)
      return throwError.call(this, "val must be a number between -1 and +1", cb);
    function adjust(value) {
      if (val < 0) {
        var x = (value > 127) ? 1 - value / 255 : value / 255;
        if (x < 0)
          x = 0;
        x = 0.5 * Math.pow(x * 2, 1 + val);
        return (value > 127) ? (1.0 - x) * 255 : x * 255;
      } else {
        var x = (value > 127) ? 1 - value / 255 : value / 255;
        if (x < 0)
          x = 0;
        x = 0.5 * Math.pow(2 * x, ((val == 1) ? 127 : 1 / (1 - val)));
        return (value > 127) ? (1 - x) * 255 : x * 255;
      }
    }
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      this.bitmap.data[idx] = adjust(this.bitmap.data[idx]);
      this.bitmap.data[idx + 1] = adjust(this.bitmap.data[idx + 1]);
      this.bitmap.data[idx + 2] = adjust(this.bitmap.data[idx + 2]);
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.posterize = function(n, cb) {
    if ("number" != typeof n)
      return throwError.call(this, "n must be numbers", cb);
    if (n < 2)
      n = 2;
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      this.bitmap.data[idx] = (Math.floor(this.bitmap.data[idx] / 255 * (n - 1)) / (n - 1)) * 255;
      this.bitmap.data[idx + 1] = (Math.floor(this.bitmap.data[idx + 1] / 255 * (n - 1)) / (n - 1)) * 255;
      this.bitmap.data[idx + 2] = (Math.floor(this.bitmap.data[idx + 2] / 255 * (n - 1)) / (n - 1)) * 255;
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  function histogram() {
    var histogram = {
      r: new Array(256).fill(0),
      g: new Array(256).fill(0),
      b: new Array(256).fill(0)
    };
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, index) {
      histogram.r[this.bitmap.data[index + 0]]++;
      histogram.g[this.bitmap.data[index + 1]]++;
      histogram.b[this.bitmap.data[index + 2]]++;
    });
    return histogram;
  }
  Jimp.prototype.normalize = function(cb) {
    var h = histogram.call(this);
    var normalize = function(value, min, max) {
      return (value - min) * 255 / (max - min);
    };
    var getBounds = function(histogramChannel) {
      return [histogramChannel.findIndex(function(value) {
        return value > 0;
      }), 255 - histogramChannel.slice().reverse().findIndex(function(value) {
        return value > 0;
      })];
    };
    var bounds = {
      r: getBounds(h.r),
      g: getBounds(h.g),
      b: getBounds(h.b)
    };
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      var r = this.bitmap.data[idx + 0];
      var g = this.bitmap.data[idx + 1];
      var b = this.bitmap.data[idx + 2];
      this.bitmap.data[idx + 0] = normalize(r, bounds.r[0], bounds.r[1]);
      this.bitmap.data[idx + 1] = normalize(g, bounds.g[0], bounds.g[1]);
      this.bitmap.data[idx + 2] = normalize(b, bounds.b[0], bounds.b[1]);
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.invert = function(cb) {
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      this.bitmap.data[idx] = 255 - this.bitmap.data[idx];
      this.bitmap.data[idx + 1] = 255 - this.bitmap.data[idx + 1];
      this.bitmap.data[idx + 2] = 255 - this.bitmap.data[idx + 2];
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.mirror = Jimp.prototype.flip = function(horizontal, vertical, cb) {
    if ("boolean" != typeof horizontal || "boolean" != typeof vertical)
      return throwError.call(this, "horizontal and vertical must be Booleans", cb);
    var bitmap = new Buffer(this.bitmap.data.length);
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      var _x = (horizontal) ? (this.bitmap.width - 1 - x) : x;
      var _y = (vertical) ? (this.bitmap.height - 1 - y) : y;
      var _idx = (this.bitmap.width * _y + _x) << 2;
      var data = this.bitmap.data.readUInt32BE(idx, true);
      bitmap.writeUInt32BE(data, _idx, true);
    });
    this.bitmap.data = new Buffer(bitmap);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.gaussian = function(r, cb) {
    if ("number" != typeof r)
      return throwError.call(this, "r must be a number", cb);
    if (r < 1)
      return throwError.call(this, "r must be greater than 0", cb);
    var rs = Math.ceil(r * 2.57);
    for (var y = 0; y < this.bitmap.height; y++) {
      log("Gaussian: " + Math.round(y / this.bitmap.height * 100) + "%");
      for (var x = 0; x < this.bitmap.width; x++) {
        var red = 0;
        var green = 0;
        var blue = 0;
        var alpha = 0;
        var wsum = 0;
        for (var iy = y - rs; iy < y + rs + 1; iy++) {
          for (var ix = x - rs; ix < x + rs + 1; ix++) {
            var x1 = Math.min(this.bitmap.width - 1, Math.max(0, ix));
            var y1 = Math.min(this.bitmap.height - 1, Math.max(0, iy));
            var dsq = (ix - x) * (ix - x) + (iy - y) * (iy - y);
            var wght = Math.exp(-dsq / (2 * r * r)) / (Math.PI * 2 * r * r);
            var idx = (y1 * this.bitmap.width + x1) << 2;
            red += this.bitmap.data[idx] * wght;
            green += this.bitmap.data[idx + 1] * wght;
            blue += this.bitmap.data[idx + 2] * wght;
            alpha += this.bitmap.data[idx + 3] * wght;
            wsum += wght;
          }
          var idx = (y * this.bitmap.width + x) << 2;
          this.bitmap.data[idx] = Math.round(red / wsum);
          this.bitmap.data[idx + 1] = Math.round(green / wsum);
          this.bitmap.data[idx + 2] = Math.round(blue / wsum);
          this.bitmap.data[idx + 3] = Math.round(alpha / wsum);
        }
      }
    }
    clear();
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  var mul_table = [1, 57, 41, 21, 203, 34, 97, 73, 227, 91, 149, 62, 105, 45, 39, 137, 241, 107, 3, 173, 39, 71, 65, 238, 219, 101, 187, 87, 81, 151, 141, 133, 249, 117, 221, 209, 197, 187, 177, 169, 5, 153, 73, 139, 133, 127, 243, 233, 223, 107, 103, 99, 191, 23, 177, 171, 165, 159, 77, 149, 9, 139, 135, 131, 253, 245, 119, 231, 224, 109, 211, 103, 25, 195, 189, 23, 45, 175, 171, 83, 81, 79, 155, 151, 147, 9, 141, 137, 67, 131, 129, 251, 123, 30, 235, 115, 113, 221, 217, 53, 13, 51, 50, 49, 193, 189, 185, 91, 179, 175, 43, 169, 83, 163, 5, 79, 155, 19, 75, 147, 145, 143, 35, 69, 17, 67, 33, 65, 255, 251, 247, 243, 239, 59, 29, 229, 113, 111, 219, 27, 213, 105, 207, 51, 201, 199, 49, 193, 191, 47, 93, 183, 181, 179, 11, 87, 43, 85, 167, 165, 163, 161, 159, 157, 155, 77, 19, 75, 37, 73, 145, 143, 141, 35, 138, 137, 135, 67, 33, 131, 129, 255, 63, 250, 247, 61, 121, 239, 237, 117, 29, 229, 227, 225, 111, 55, 109, 216, 213, 211, 209, 207, 205, 203, 201, 199, 197, 195, 193, 48, 190, 47, 93, 185, 183, 181, 179, 178, 176, 175, 173, 171, 85, 21, 167, 165, 41, 163, 161, 5, 79, 157, 78, 154, 153, 19, 75, 149, 74, 147, 73, 144, 143, 71, 141, 140, 139, 137, 17, 135, 134, 133, 66, 131, 65, 129, 1];
  var shg_table = [0, 9, 10, 10, 14, 12, 14, 14, 16, 15, 16, 15, 16, 15, 15, 17, 18, 17, 12, 18, 16, 17, 17, 19, 19, 18, 19, 18, 18, 19, 19, 19, 20, 19, 20, 20, 20, 20, 20, 20, 15, 20, 19, 20, 20, 20, 21, 21, 21, 20, 20, 20, 21, 18, 21, 21, 21, 21, 20, 21, 17, 21, 21, 21, 22, 22, 21, 22, 22, 21, 22, 21, 19, 22, 22, 19, 20, 22, 22, 21, 21, 21, 22, 22, 22, 18, 22, 22, 21, 22, 22, 23, 22, 20, 23, 22, 22, 23, 23, 21, 19, 21, 21, 21, 23, 23, 23, 22, 23, 23, 21, 23, 22, 23, 18, 22, 23, 20, 22, 23, 23, 23, 21, 22, 20, 22, 21, 22, 24, 24, 24, 24, 24, 22, 21, 24, 23, 23, 24, 21, 24, 23, 24, 22, 24, 24, 22, 24, 24, 22, 23, 24, 24, 24, 20, 23, 22, 23, 24, 24, 24, 24, 24, 24, 24, 23, 21, 23, 22, 23, 24, 24, 24, 22, 24, 24, 24, 23, 22, 24, 24, 25, 23, 25, 25, 23, 24, 25, 25, 24, 22, 25, 25, 25, 24, 23, 24, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 23, 25, 23, 24, 25, 25, 25, 25, 25, 25, 25, 25, 25, 24, 22, 25, 25, 23, 25, 25, 20, 24, 25, 24, 25, 25, 22, 24, 25, 24, 25, 24, 25, 25, 24, 25, 25, 25, 25, 22, 25, 25, 25, 24, 25, 24, 25, 18];
  Jimp.prototype.blur = function(r, cb) {
    if ("number" != typeof r)
      return throwError.call(this, "r must be a number", cb);
    if (r < 1)
      return throwError.call(this, "r must be greater than 0", cb);
    var rsum,
        gsum,
        bsum,
        asum,
        x,
        y,
        i,
        p,
        p1,
        p2,
        yp,
        yi,
        yw,
        idx,
        pa;
    var wm = this.bitmap.width - 1;
    var hm = this.bitmap.height - 1;
    var wh = this.bitmap.width * this.bitmap.height;
    var rad1 = r + 1;
    var mul_sum = mul_table[r];
    var shg_sum = shg_table[r];
    var red = [];
    var green = [];
    var blue = [];
    var alpha = [];
    var vmin = [];
    var vmax = [];
    var iterations = 2;
    while (iterations-- > 0) {
      yw = yi = 0;
      for (y = 0; y < this.bitmap.height; y++) {
        rsum = this.bitmap.data[yw] * rad1;
        gsum = this.bitmap.data[yw + 1] * rad1;
        bsum = this.bitmap.data[yw + 2] * rad1;
        asum = this.bitmap.data[yw + 3] * rad1;
        for (i = 1; i <= r; i++) {
          p = yw + (((i > wm ? wm : i)) << 2);
          rsum += this.bitmap.data[p++];
          gsum += this.bitmap.data[p++];
          bsum += this.bitmap.data[p++];
          asum += this.bitmap.data[p];
        }
        for (x = 0; x < this.bitmap.width; x++) {
          red[yi] = rsum;
          green[yi] = gsum;
          blue[yi] = bsum;
          alpha[yi] = asum;
          if (y == 0) {
            vmin[x] = ((p = x + rad1) < wm ? p : wm) << 2;
            vmax[x] = ((p = x - r) > 0 ? p << 2 : 0);
          }
          p1 = yw + vmin[x];
          p2 = yw + vmax[x];
          rsum += this.bitmap.data[p1++] - this.bitmap.data[p2++];
          gsum += this.bitmap.data[p1++] - this.bitmap.data[p2++];
          bsum += this.bitmap.data[p1++] - this.bitmap.data[p2++];
          asum += this.bitmap.data[p1] - this.bitmap.data[p2];
          yi++;
        }
        yw += (this.bitmap.width << 2);
      }
      for (x = 0; x < this.bitmap.width; x++) {
        yp = x;
        rsum = red[yp] * rad1;
        gsum = green[yp] * rad1;
        bsum = blue[yp] * rad1;
        asum = alpha[yp] * rad1;
        for (i = 1; i <= r; i++) {
          yp += (i > hm ? 0 : this.bitmap.width);
          rsum += red[yp];
          gsum += green[yp];
          bsum += blue[yp];
          asum += alpha[yp];
        }
        yi = x << 2;
        for (y = 0; y < this.bitmap.height; y++) {
          this.bitmap.data[yi + 3] = pa = (asum * mul_sum) >>> shg_sum;
          if (pa > 255)
            this.bitmap.data[yi + 3] = 255;
          if (pa > 0) {
            pa = 255 / pa;
            this.bitmap.data[yi] = ((rsum * mul_sum) >>> shg_sum) * pa;
            this.bitmap.data[yi + 1] = ((gsum * mul_sum) >>> shg_sum) * pa;
            this.bitmap.data[yi + 2] = ((bsum * mul_sum) >>> shg_sum) * pa;
          } else {
            this.bitmap.data[yi] = this.bitmap.data[yi + 1] = this.bitmap.data[yi + 2] = 0;
          }
          if (x == 0) {
            vmin[y] = ((p = y + rad1) < hm ? p : hm) * this.bitmap.width;
            vmax[y] = ((p = y - r) > 0 ? p * this.bitmap.width : 0);
          }
          p1 = x + vmin[y];
          p2 = x + vmax[y];
          rsum += red[p1] - red[p2];
          gsum += green[p1] - green[p2];
          bsum += blue[p1] - blue[p2];
          asum += alpha[p1] - alpha[p2];
          yi += this.bitmap.width << 2;
        }
      }
    }
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.convolution = function(kernel, edgeHandling, cb) {
    if ("function" == typeof edgeHandling && "undefined" == typeof cb) {
      cb = edgeHandling;
      edgeHandling = null;
    }
    if (!edgeHandling)
      edgeHandling = Jimp.EDGE_EXTEND;
    var newData = new Buffer(this.bitmap.data),
        weight,
        rSum,
        gSum,
        bSum,
        ri,
        gi,
        bi,
        xi,
        yi,
        idxi,
        kRows = kernel.length,
        kCols = kernel[0].length,
        rowEnd = Math.floor(kRows / 2),
        colEnd = Math.floor(kCols / 2),
        rowIni = -rowEnd,
        colIni = -colEnd;
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      rSum = gSum = bSum = 0;
      for (row = rowIni; row <= rowEnd; row++) {
        for (col = colIni; col <= colEnd; col++) {
          xi = x + col;
          yi = y + row;
          weight = kernel[row + rowEnd][col + colEnd];
          idxi = this.getPixelIndex(xi, yi, edgeHandling);
          if (idxi == -1)
            ri = gi = bi = 0;
          else {
            ri = this.bitmap.data[idxi + 0];
            gi = this.bitmap.data[idxi + 1];
            bi = this.bitmap.data[idxi + 2];
          }
          rSum += weight * ri;
          gSum += weight * gi;
          bSum += weight * bi;
        }
      }
      if (rSum < 0)
        rSum = 0;
      if (gSum < 0)
        gSum = 0;
      if (bSum < 0)
        bSum = 0;
      if (rSum > 255)
        rSum = 255;
      if (gSum > 255)
        gSum = 255;
      if (bSum > 255)
        bSum = 255;
      newData[idx + 0] = rSum;
      newData[idx + 1] = gSum;
      newData[idx + 2] = bSum;
    });
    this.bitmap.data = newData;
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.greyscale = function(cb) {
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      var grey = parseInt(.2126 * this.bitmap.data[idx] + .7152 * this.bitmap.data[idx + 1] + .0722 * this.bitmap.data[idx + 2], 10);
      this.bitmap.data[idx] = grey;
      this.bitmap.data[idx + 1] = grey;
      this.bitmap.data[idx + 2] = grey;
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.grayscale = Jimp.prototype.greyscale;
  Jimp.prototype.sepia = function(cb) {
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      var red = this.bitmap.data[idx];
      var green = this.bitmap.data[idx + 1];
      var blue = this.bitmap.data[idx + 2];
      red = (red * 0.393) + (green * 0.769) + (blue * 0.189);
      green = (red * 0.349) + (green * 0.686) + (blue * 0.168);
      blue = (red * 0.272) + (green * 0.534) + (blue * 0.131);
      this.bitmap.data[idx] = (red < 255) ? red : 255;
      this.bitmap.data[idx + 1] = (green < 255) ? green : 255;
      this.bitmap.data[idx + 2] = (blue < 255) ? blue : 255;
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.opacity = function(f, cb) {
    if ("number" != typeof f)
      return throwError.call(this, "f must be a number", cb);
    if (f < 0 || f > 1)
      return throwError.call(this, "f must be a number from 0 to 1", cb);
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      var v = this.bitmap.data[idx + 3] * f;
      this.bitmap.data[idx + 3] = v;
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.fade = function(f, cb) {
    if ("number" != typeof f)
      return throwError.call(this, "f must be a number", cb);
    if (f < 0 || f > 1)
      return throwError.call(this, "f must be a number from 0 to 1", cb);
    this.opacity(1 - f);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.opaque = function(cb) {
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      this.bitmap.data[idx + 3] = 255;
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.resize = function(w, h, mode, cb) {
    if ("number" != typeof w || "number" != typeof h)
      return throwError.call(this, "w and h must be numbers", cb);
    if ("function" == typeof mode && "undefined" == typeof cb) {
      cb = mode;
      mode = null;
    }
    if (w == Jimp.AUTO && h == Jimp.AUTO)
      return throwError.call(this, "w and h cannot both the set to auto", cb);
    if (w == Jimp.AUTO)
      w = this.bitmap.width * (h / this.bitmap.height);
    if (h == Jimp.AUTO)
      h = this.bitmap.height * (w / this.bitmap.width);
    w = Math.round(w);
    h = Math.round(h);
    if ("function" == typeof Resize2[mode]) {
      var dst = {
        data: new Buffer(w * h * 4),
        width: w,
        height: h
      };
      Resize2[mode](this.bitmap, dst);
      this.bitmap = dst;
    } else {
      var that = this;
      var resize = new Resize(this.bitmap.width, this.bitmap.height, w, h, true, true, function(buffer) {
        that.bitmap.data = new Buffer(buffer);
        that.bitmap.width = w;
        that.bitmap.height = h;
      });
      resize.resize(this.bitmap.data);
    }
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.cover = function(w, h, alignBits, mode, cb) {
    if ("number" != typeof w || "number" != typeof h)
      return throwError.call(this, "w and h must be numbers", cb);
    if (alignBits && "function" == typeof alignBits && "undefined" == typeof cb) {
      cb = alignBits;
      alignBits = null;
      mode = null;
    } else if ("function" == typeof mode && "undefined" == typeof cb) {
      cb = mode;
      mode = null;
    }
    alignBits = alignBits || (Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
    var hbits = ((alignBits) & ((1 << (3)) - 1));
    var vbits = alignBits >> 3;
    if (!(((hbits != 0) && !(hbits & (hbits - 1))) || ((vbits != 0) && !(vbits & (vbits - 1)))))
      return throwError.call(this, "only use one flag per alignment direction", cb);
    var align_h = (hbits >> 1);
    var align_v = (vbits >> 1);
    var f = (w / h > this.bitmap.width / this.bitmap.height) ? w / this.bitmap.width : h / this.bitmap.height;
    this.scale(f, mode);
    this.crop(((this.bitmap.width - w) / 2) * align_h, ((this.bitmap.height - h) / 2) * align_v, w, h);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.contain = function(w, h, alignBits, mode, cb) {
    if ("number" != typeof w || "number" != typeof h)
      return throwError.call(this, "w and h must be numbers", cb);
    switch (typeof alignBits) {
      case 'string':
        if ("function" == typeof mode && "undefined" == typeof cb)
          cb = mode;
        mode = alignBits;
        alignBits = null;
      case 'function':
        if ("undefined" == typeof cb)
          cb = alignBits;
        mode = null;
        alignBits = null;
      default:
        if ("function" == typeof mode && "undefined" == typeof cb) {
          cb = mode;
          mode = null;
        }
    }
    alignBits = alignBits || (Jimp.HORIZONTAL_ALIGN_CENTER | Jimp.VERTICAL_ALIGN_MIDDLE);
    var hbits = ((alignBits) & ((1 << (3)) - 1));
    var vbits = alignBits >> 3;
    if (!(((hbits != 0) && !(hbits & (hbits - 1))) || ((vbits != 0) && !(vbits & (vbits - 1)))))
      return throwError.call(this, "only use one flag per alignment direction", cb);
    var align_h = (hbits >> 1);
    var align_v = (vbits >> 1);
    var f = (w / h > this.bitmap.width / this.bitmap.height) ? h / this.bitmap.height : w / this.bitmap.width;
    var c = this.clone().scale(f, mode);
    this.resize(w, h, mode);
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      this.bitmap.data.writeUInt32BE(this._background, idx);
    });
    this.blit(c, ((this.bitmap.width - c.bitmap.width) / 2) * align_h, ((this.bitmap.height - c.bitmap.height) / 2) * align_v);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.scale = function(f, mode, cb) {
    if ("number" != typeof f)
      return throwError.call(this, "f must be a number", cb);
    if (f < 0)
      return throwError.call(this, "f must be a positive number", cb);
    if ("function" == typeof mode && "undefined" == typeof cb) {
      cb = mode;
      mode = null;
    }
    var w = this.bitmap.width * f;
    var h = this.bitmap.height * f;
    this.resize(w, h, mode);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.scaleToFit = function(w, h, mode, cb) {
    if ("number" != typeof w || "number" != typeof h)
      return throwError.call(this, "w and h must be numbers", cb);
    if ("function" == typeof mode && "undefined" == typeof cb) {
      cb = mode;
      mode = null;
    }
    var f = (w / h > this.bitmap.width / this.bitmap.height) ? h / this.bitmap.height : w / this.bitmap.width;
    this.scale(f, mode);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  function simpleRotate(deg) {
    var i = Math.round(deg / 90) % 4;
    while (i < 0)
      i += 4;
    while (i > 0) {
      var dstBuffer = new Buffer(this.bitmap.data.length);
      var dstOffset = 0;
      for (var x = 0; x < this.bitmap.width; x++) {
        for (var y = this.bitmap.height - 1; y >= 0; y--) {
          var srcOffset = (this.bitmap.width * y + x) << 2;
          var data = this.bitmap.data.readUInt32BE(srcOffset, true);
          dstBuffer.writeUInt32BE(data, dstOffset, true);
          dstOffset += 4;
        }
      }
      this.bitmap.data = new Buffer(dstBuffer);
      var tmp = this.bitmap.width;
      this.bitmap.width = this.bitmap.height;
      this.bitmap.height = tmp;
      i--;
    }
  }
  function advancedRotate(deg, mode) {
    var rad = (deg % 360) * Math.PI / 180;
    var cosine = Math.cos(rad);
    var sine = Math.sin(rad);
    var w,
        h;
    if (mode == true || "string" == typeof mode) {
      w = Math.round(Math.abs(this.bitmap.width * cosine) + Math.abs(this.bitmap.height * sine));
      h = Math.round(Math.abs(this.bitmap.width * sine) + Math.abs(this.bitmap.height * cosine));
      var c = this.clone();
      this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
        this.bitmap.data.writeUInt32BE(this._background, idx);
      });
      var max = Math.max(w, h, this.bitmap.width, this.bitmap.height);
      this.resize(max, max, mode);
      this.blit(c, this.bitmap.width / 2 - c.bitmap.width / 2, this.bitmap.height / 2 - c.bitmap.height / 2);
    }
    var dstBuffer = new Buffer(this.bitmap.data.length);
    function createTranslationFunction(deltaX, deltaY) {
      return function(x, y) {
        return {
          x: (x + deltaX),
          y: (y + deltaY)
        };
      };
    }
    var translate2Cartesian = createTranslationFunction(-(this.bitmap.width / 2), -(this.bitmap.height / 2));
    var translate2Screen = createTranslationFunction(this.bitmap.width / 2, this.bitmap.height / 2);
    for (var y = 0; y < this.bitmap.height; y++) {
      for (var x = 0; x < this.bitmap.width; x++) {
        var cartesian = translate2Cartesian(x, this.bitmap.height - y);
        var source = translate2Screen(cosine * cartesian.x - sine * cartesian.y, cosine * cartesian.y + sine * cartesian.x);
        if (source.x >= 0 && source.x < this.bitmap.width && source.y >= 0 && source.y < this.bitmap.height) {
          var srcIdx = (this.bitmap.width * (this.bitmap.height - source.y - 1 | 0) + source.x | 0) << 2;
          var pixelRGBA = this.bitmap.data.readUInt32BE(srcIdx, true);
          var dstIdx = (this.bitmap.width * y + x) << 2;
          dstBuffer.writeUInt32BE(pixelRGBA, dstIdx);
        } else {
          var dstIdx = (this.bitmap.width * y + x) << 2;
          dstBuffer.writeUInt32BE(this._background, dstIdx);
        }
      }
    }
    this.bitmap.data = dstBuffer;
    if (mode == true || "string" == typeof mode) {
      var x = (this.bitmap.width / 2) - (w / 2);
      var y = (this.bitmap.height / 2) - (h / 2);
      this.crop(x, y, w, h);
    }
  }
  ;
  Jimp.prototype.rotate = function(deg, mode, cb) {
    if ("undefined" == typeof mode || mode === null) {
      mode = true;
    }
    if ("function" == typeof mode && "undefined" == typeof cb) {
      cb = mode;
      mode = true;
    }
    if ("number" != typeof deg)
      return throwError.call(this, "deg must be a number", cb);
    if ("boolean" != typeof mode && "string" != typeof mode)
      return throwError.call(this, "mode must be a boolean or a string", cb);
    if (deg % 90 == 0 && mode !== false)
      simpleRotate.call(this, deg, cb);
    else
      advancedRotate.call(this, deg, mode, cb);
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.getBuffer = function(mime, cb) {
    if (mime == Jimp.AUTO) {
      mime = this.getMIME();
    }
    if ("string" != typeof mime)
      return throwError.call(this, "mime must be a string", cb);
    if ("function" != typeof cb)
      return throwError.call(this, "cb must be a function", cb);
    switch (mime.toLowerCase()) {
      case Jimp.MIME_PNG:
        var that = this;
        var png = new PNG({
          width: this.bitmap.width,
          height: this.bitmap.height,
          bitDepth: 8,
          deflateLevel: this._deflateLevel,
          deflateStrategy: this._deflateStrategy,
          filterType: this._filterType,
          colorType: (this._rgba) ? 6 : 2,
          inputHasAlpha: true
        });
        if (this._rgba)
          png.data = new Buffer(this.bitmap.data);
        else
          png.data = compositeBitmapOverBackground(this).data;
        StreamToBuffer(png.pack(), function(err, buffer) {
          return cb.call(that, null, buffer);
        });
        break;
      case Jimp.MIME_JPEG:
        var jpeg = JPEG.encode(compositeBitmapOverBackground(this), this._quality);
        return cb.call(this, null, jpeg.data);
      case Jimp.MIME_BMP:
        var bmp = BMP.encode(compositeBitmapOverBackground(this));
        return cb.call(this, null, bmp.data);
      default:
        return cb.call(this, "Unsupported MIME type: " + mime);
    }
    return this;
  };
  function compositeBitmapOverBackground(image) {
    return (new Jimp(image.bitmap.width, image.bitmap.height, image._background)).composite(image, 0, 0).bitmap;
  }
  Jimp.prototype.getBase64 = function(mime, cb) {
    if (mime == Jimp.AUTO) {
      mime = this.getMIME();
    }
    if ("string" != typeof mime)
      return throwError.call(this, "mime must be a string", cb);
    if ("function" != typeof cb)
      return throwError.call(this, "cb must be a function", cb);
    this.getBuffer(mime, function(err, data) {
      var src = "data:" + mime + ";base64," + data.toString("base64");
      return cb.call(this, null, src);
    });
    return this;
  };
  Jimp.prototype.dither565 = function(cb) {
    var rgb565_matrix = [1, 9, 3, 11, 13, 5, 15, 7, 4, 12, 2, 10, 16, 8, 14, 6];
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      var tresshold_id = ((y & 3) << 2) + (x % 4);
      var dither = rgb565_matrix[tresshold_id];
      this.bitmap.data[idx] = Math.min(this.bitmap.data[idx] + dither, 0xff);
      this.bitmap.data[idx + 1] = Math.min(this.bitmap.data[idx + 1] + dither, 0xff);
      this.bitmap.data[idx + 2] = Math.min(this.bitmap.data[idx + 2] + dither, 0xff);
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.prototype.dither16 = Jimp.prototype.dither565;
  Jimp.prototype.color = Jimp.prototype.colour = function(actions, cb) {
    if (!actions || !Array.isArray(actions))
      return throwError.call(this, "actions must be an array", cb);
    var originalScope = this;
    this.scan(0, 0, this.bitmap.width, this.bitmap.height, function(x, y, idx) {
      var clr = TinyColor({
        r: this.bitmap.data[idx],
        g: this.bitmap.data[idx + 1],
        b: this.bitmap.data[idx + 2]
      });
      var colorModifier = function(i, amount) {
        c = clr.toRgb();
        c[i] = Math.max(0, Math.min(c[i] + amount, 255));
        return TinyColor(c);
      };
      actions.forEach(function(action) {
        if (action.apply === "mix") {
          clr = TinyColor.mix(clr, action.params[0], action.params[1]);
        } else if (action.apply === "tint") {
          clr = TinyColor.mix(clr, "white", action.params[0]);
        } else if (action.apply === "shade") {
          clr = TinyColor.mix(clr, "black", action.params[0]);
        } else if (action.apply === "xor") {
          var clr2 = TinyColor(action.params[0]).toRgb();
          clr = clr.toRgb();
          clr = TinyColor({
            r: clr.r ^ clr2.r,
            g: clr.g ^ clr2.g,
            b: clr.b ^ clr2.b
          });
        } else if (action.apply === "red") {
          clr = colorModifier("r", action.params[0]);
        } else if (action.apply === "green") {
          clr = colorModifier("g", action.params[0]);
        } else if (action.apply === "blue") {
          clr = colorModifier("b", action.params[0]);
        } else {
          if (action.apply === "hue") {
            action.apply = "spin";
          }
          var fn = clr[action.apply];
          if (!fn) {
            return throwError.call(originalScope, "action " + action.apply + " not supported", cb);
          }
          clr = fn.apply(clr, action.params);
        }
      });
      clr = clr.toRgb();
      this.bitmap.data[idx] = clr.r;
      this.bitmap.data[idx + 1] = clr.g;
      this.bitmap.data[idx + 2] = clr.b;
    });
    if (isNodePattern(cb))
      return cb.call(this, null, this);
    else
      return this;
  };
  Jimp.loadFont = function(file, cb) {
    if ("string" != typeof file)
      return throwError.call(this, "file must be a string", cb);
    var that = this;
    return new Promise(function(resolve, reject) {
      cb = cb || function(err, font) {
        if (err)
          reject(err);
        else
          resolve(font);
      };
      BMFont(file, function(err, font) {
        var chars = {},
            kernings = {};
        if (err)
          return throwError.call(that, err, cb);
        for (var i = 0; i < font.chars.length; i++) {
          chars[String.fromCharCode(font.chars[i].id)] = font.chars[i];
        }
        for (var i = 0; i < font.kernings.length; i++) {
          var firstString = String.fromCharCode(font.kernings[i].first);
          kernings[firstString] = kernings[firstString] || {};
          kernings[firstString][String.fromCharCode(font.kernings[i].second)] = font.kernings[i].amount;
        }
        loadPages(Path.dirname(file), font.pages).then(function(pages) {
          cb(null, {
            chars: chars,
            kernings: kernings,
            pages: pages,
            common: font.common,
            info: font.info
          });
        });
      });
    });
  };
  function loadPages(dir, pages) {
    var newPages = pages.map(function(page) {
      return Jimp.read(dir + '/' + page);
    });
    return Promise.all(newPages);
  }
  Jimp.prototype.print = function(font, x, y, text, maxWidth, cb) {
    if ("function" == typeof maxWidth && "undefined" == typeof cb) {
      cb = maxWidth;
      maxWidth = Infinity;
    }
    if ("undefined" == typeof maxWidth) {
      maxWidth = Infinity;
    }
    if ("object" != typeof font)
      return throwError.call(this, "font must be a Jimp loadFont", cb);
    if ("number" != typeof x || "number" != typeof y || "number" != typeof maxWidth)
      return throwError.call(this, "x, y and maxWidth must be numbers", cb);
    if ("string" != typeof text)
      return throwError.call(this, "text must be a string", cb);
    if ("number" != typeof maxWidth)
      return throwError.call(this, "maxWidth must be a number", cb);
    var that = this;
    var words = text.split(' ');
    var line = '';
    for (var n = 0; n < words.length; n++) {
      var testLine = line + words[n] + ' ';
      var testWidth = measureText(font, testLine);
      if (testWidth > maxWidth && n > 0) {
        that = that.print(font, x, y, line);
        line = words[n] + ' ';
        y += font.common.lineHeight;
      } else {
        line = testLine;
      }
    }
    printText.call(this, font, x, y, line);
    if (isNodePattern(cb))
      return cb.call(this, null, that);
    else
      return that;
  };
  function printText(font, x, y, text) {
    for (var i = 0; i < text.length; i++) {
      if (font.chars[text[i]]) {
        drawCharacter(this, font, x, y, font.chars[text[i]]);
        x += (font.kernings[text[i]] && font.kernings[text[i]][text[i + 1]] ? font.kernings[text[i]][text[i + 1]] : 0) + (font.chars[text[i]].xadvance || 0);
      }
    }
  }
  ;
  function drawCharacter(image, font, x, y, char) {
    if (char.width > 0 && char.height > 0) {
      var imageChar = font.pages[char.page].clone().crop(char.x, char.y, char.width, char.height);
      return image.composite(imageChar, x + char.xoffset, y + char.yoffset);
    }
    return image;
  }
  ;
  function measureText(font, text) {
    var x = 0;
    for (var i = 0; i < text.length; i++) {
      if (font.chars[text[i]]) {
        x += font.chars[text[i]].xoffset + (font.kernings[text[i]] && font.kernings[text[i]][text[i + 1]] ? font.kernings[text[i]][text[i + 1]] : 0) + (font.chars[text[i]].xadvance || 0);
      }
    }
    return x;
  }
  ;
  Jimp.prototype.write = function(path, cb) {
    if ("string" != typeof path)
      return throwError.call(this, "path must be a string", cb);
    if ("undefined" == typeof cb)
      cb = function() {};
    if ("function" != typeof cb)
      return throwError.call(this, "cb must be a function", cb);
    var that = this;
    var mime = MIME.lookup(path);
    this.getBuffer(mime, function(err, buffer) {
      if (err)
        return throwError.call(that, err, cb);
      var stream = FS.createWriteStream(path);
      stream.on("open", function(fh) {
        stream.write(buffer);
        stream.end();
      }).on("error", function(err) {
        return throwError.call(that, err, cb);
      });
      stream.on("finish", function(fh) {
        return cb.call(that, null, that);
      });
    });
    return this;
  };
  (function() {
    function fetchImageDataFromUrl(url, cb) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "arraybuffer";
      xhr.onload = function() {
        if (xhr.status < 400)
          cb(this.response, null);
        else
          cb(null, "HTTP Status " + xhr.status + " for url " + url);
      };
      xhr.onerror = function(e) {
        cb(null, e);
      };
      xhr.send();
    }
    ;
    function bufferFromArrayBuffer(arrayBuffer) {
      var buffer = new Buffer(arrayBuffer.byteLength);
      var view = new Uint8Array(arrayBuffer);
      for (var i = 0; i < buffer.length; ++i) {
        buffer[i] = view[i];
      }
      return buffer;
    }
    function isArrayBuffer(test) {
      return Object.prototype.toString.call(test).toLowerCase().indexOf("arraybuffer") > -1;
    }
    delete Jimp.prototype.write;
    delete Jimp.read;
    Jimp.read = function(src, cb) {
      return new Promise(function(resolve, reject) {
        cb = cb || function(err, image) {
          if (err)
            reject(err);
          else
            resolve(image);
        };
        if ("string" == typeof src) {
          fetchImageDataFromUrl(src, function(arrayBuffer, error) {
            if (arrayBuffer) {
              if (!isArrayBuffer(arrayBuffer)) {
                cb(new Error("Unrecognized data received for " + src));
              } else {
                new Jimp(bufferFromArrayBuffer(arrayBuffer), cb);
              }
            } else if (error) {
              cb(error);
            }
          });
        } else if (isArrayBuffer(src)) {
          new Jimp(bufferFromArrayBuffer(src), cb);
        } else {
          cb(new Error("Jimp expects a single ArrayBuffer or image URL"));
        }
      });
    };
  })();
  module.exports = Jimp;
})(require('buffer').Buffer, require('process'));
