/* */ 
'use strict';
const isCUR = require('./is-cur');
const isICO = require('./is-ico');
const parseBMP = require('./parse-bmp');
const range = require('./utils/range');
const parseICO = (arrayBuffer) => {
  if (!isCUR(arrayBuffer) && !isICO(arrayBuffer)) {
    throw new Error('buffer is not ico');
  }
  const dataView = new DataView(arrayBuffer);
  const count = dataView.getUint16(4, true);
  const infoHeaders = range(count).map((index) => {
    const length = 16;
    const offset = 6 + (index * length);
    return arrayBuffer.slice(offset, offset + length);
  });
  const bitmaps = range(count).map((index) => {
    const infoHeader = new DataView(infoHeaders[index]);
    const length = infoHeader.getUint32(8, true);
    const offset = infoHeader.getUint32(12, true);
    return arrayBuffer.slice(offset, offset + length);
  });
  const icos = range(count).map((index) => {
    const infoHeader = new DataView(infoHeaders[index]);
    const width = infoHeader.getUint8(0) || 256;
    const height = infoHeader.getUint8(1) || 256;
    return parseBMP(width, height, bitmaps[index]);
  });
  if (isICO(arrayBuffer)) {
    return icos;
  }
  const hotspots = range(count).map((index) => {
    const infoHeader = new DataView(infoHeaders[index]);
    return {
      x: infoHeader.getUint16(4, true),
      y: infoHeader.getUint16(6, true)
    };
  });
  return range(count).map((index) => Object.assign(icos[index], {hotspot: hotspots[index]}));
};
module.exports = parseICO;
