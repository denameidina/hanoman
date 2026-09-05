const test = require('node:test');
const assert = require('node:assert/strict');
const { createReceiver } = require('./app.cjs');
const cases = require('./cases.json');
for (const [index, sample] of cases.entries()) {
  test(`deliveries ${index}`, () => {
    const receiver = createReceiver();
    for (const id of sample.deliveries) receiver.receive({ id });
    assert.equal(receiver.count(), sample.expectedCount);
  });
}
