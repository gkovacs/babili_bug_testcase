/* */ 
(function(Buffer) {
  'use strict';
  var hasSyncZlib = true;
  var zlib = require('zlib');
  var constants = require('./constants');
  var Packer = require('./packer');
  module.exports = function(metaData, opt) {
    if (!hasSyncZlib) {
      throw new Error('To use the sync capability of this library in old node versions, please pin pngjs to v2.3.0');
    }
    var options = opt || {};
    var packer = new Packer(options);
    var chunks = [];
    chunks.push(new Buffer(constants.PNG_SIGNATURE));
    chunks.push(packer.packIHDR(metaData.width, metaData.height));
    if (metaData.gamma) {
      chunks.push(packer.packGAMA(metaData.gamma));
    }
    var filteredData = packer.filterData(metaData.data, metaData.width, metaData.height);
    var compressedData = zlib.deflateSync(filteredData, packer.getDeflateOptions());
    filteredData = null;
    if (!compressedData || !compressedData.length) {
      throw new Error('bad png - invalid compressed data response');
    }
    chunks.push(packer.packIDAT(compressedData));
    chunks.push(packer.packIEND());
    return Buffer.concat(chunks);
  };
})(require('buffer').Buffer);
