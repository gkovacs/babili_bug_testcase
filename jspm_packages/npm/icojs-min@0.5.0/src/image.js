/* */ 
'use strict';
const Jimp = require('jimp');
const bufferToArrayBuffer = require('./utils/buffer-to-arraybuffer');
const Image = {encode(image, mime) {
    const data = image.data;
    const jimp = new Jimp(image.width, image.height);
    jimp.scan(0, 0, jimp.bitmap.width, jimp.bitmap.height, function scan(x, y, idx) {
      this.bitmap.data[idx + 0] = data[idx + 0];
      this.bitmap.data[idx + 1] = data[idx + 1];
      this.bitmap.data[idx + 2] = data[idx + 2];
      this.bitmap.data[idx + 3] = data[idx + 3];
    });
    return new Promise((resolve, reject) => {
      jimp.getBuffer(mime || Jimp.MIME_PNG, (err, buffer) => {
        if (err) {
          reject(err);
        } else {
          resolve(bufferToArrayBuffer(buffer));
        }
      });
    });
  }};
module.exports = Image;
