const { add } = require('./math');

function log(message) {
  return `${message}: ${add(1, 1)}`;
}

exports.log = log;
exports.LEVEL = 'info';
