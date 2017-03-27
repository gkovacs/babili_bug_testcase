/* */ 
var rb = require('crypto').randomBytes;
function rng() {
  return rb(16);
}
;
module.exports = rng;
