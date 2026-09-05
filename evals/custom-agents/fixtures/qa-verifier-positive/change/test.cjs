const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail } = require('./app.cjs');
const cases = require('./cases.json');
for (const [index, sample] of cases.entries()) {
  test(`normalize ${index}`, () => assert.equal(normalizeEmail(sample.input), sample.expected));
}
