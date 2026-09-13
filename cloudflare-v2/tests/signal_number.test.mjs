import test from 'node:test';
import assert from 'node:assert/strict';

import { parseSignalNumber, extractSignalNumbers } from '../src/normalization/signal_number.js';

test('parses plain and human-grouped market prices without truncating them', () => {
  assert.deepEqual(parseSignalNumber('77,400.54'), {
    ok: true,
    value: 77400.54,
    raw: '77,400.54',
    normalized: '77400.54',
    confidence: 'HIGH',
    repairReason: null,
  });
  assert.equal(parseSignalNumber('77 400.54').value, 77400.54);
  assert.equal(parseSignalNumber('77400.54').value, 77400.54);
  assert.equal(parseSignalNumber('77,400').value, 77400);
  assert.equal(parseSignalNumber('77400').value, 77400);
});

test('repairs one uniquely safe duplicated decimal separator but rejects ambiguous malformed prices', () => {
  const repaired = parseSignalNumber('77,610,00');
  assert.equal(repaired.ok, true);
  assert.equal(repaired.value, 77610);
  assert.equal(repaired.normalized, '77610.00');
  assert.equal(repaired.confidence, 'HIGH');
  assert.equal(repaired.repairReason, 'DUPLICATE_DECIMAL_SEPARATOR');

  const ambiguous = parseSignalNumber('1,234,56,78');
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.reason, 'AMBIGUOUS_NUMBER');
});

test('does not accept negative prices unless the caller explicitly permits them', () => {
  assert.equal(parseSignalNumber('-1.25').ok, false);
  assert.equal(parseSignalNumber('-1.25', { allowNegative: true }).value, -1.25);
});

test('extracts grouped TP values as complete tokens rather than comma fragments', () => {
  const tokens = extractSignalNumbers('77,400.54 77,610,00 78,201.24');
  assert.deepEqual(tokens.map((token) => token.value), [77400.54, 77610, 78201.24]);
  assert.equal(tokens.every((token) => token.ok), true);
});
