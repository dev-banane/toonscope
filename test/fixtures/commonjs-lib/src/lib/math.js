function add(a, b) {
  return a + b;
}

function multiply(a, b = 1) {
  return a * b;
}

module.exports = { add, multiply };
