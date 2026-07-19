const math = require('./lib/math');
const { log } = require('./lib/logger');

module.exports.run = function run() {
  log('running');
  return math.add(2, 3);
};
