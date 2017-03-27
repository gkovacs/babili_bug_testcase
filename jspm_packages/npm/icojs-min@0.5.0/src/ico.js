/* */ 
'use strict';
const parseICO = require('./parse-ico');
const isICO = require('./is-ico');
const factory = (config) => {
  const previousICO = global.ICO;
  const Image = config.Image;
  const ICO = {
    parse(buffer, mime) {
      try {
        const icos = parseICO(buffer).map((ico) => Image.encode(ico, mime).then((imageBuffer) => {
          const image = {
            bit: ico.bit,
            width: ico.width,
            height: ico.height,
            buffer: imageBuffer
          };
          if (ico.hotspot) {
            image.hotspot = ico.hotspot;
          }
          return image;
        }));
        return Promise.all(icos);
      } catch (err) {
        return Promise.reject(err);
      }
    },
    isICO(buffer) {
      return isICO(buffer);
    },
    noConflict() {
      global.ICO = previousICO;
      return this;
    }
  };
  return ICO;
};
module.exports = factory;
