'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { centsFromAmount } = require('../backend/src/document-pipeline/accounting-pipeline');
const { createDecisionEngine } = require('../backend/src/document-pipeline/decision-engine');

test('centsFromAmount aceita decimal ponto e vírgula BR', () => {
  assert.equal(centsFromAmount('2158.81'), 215881);
  assert.equal(centsFromAmount('2.158,81'), 215881);
  assert.equal(centsFromAmount('2158,81'), 215881);
  assert.equal(centsFromAmount(2158.81), 215881);
  assert.equal(centsFromAmount('42.00'), 4200);
  assert.equal(centsFromAmount('1.234.567,89'), 123456789);
});

test('accountsFromAiSuggestion monta D/C a partir de primary_account + banco', () => {
  const engine = createDecisionEngine({
    db: {
      prepare() {
        return { get: () => null, all: () => [], run: () => ({}) };
      }
    },
    classify: () => ({ status: 'NEEDS_CLASSIFICATION' }),
    matchHistory: () => null,
    matchCategory: () => null,
    defaultBank: () => null
  });
  const bank = { id: 'bank-1', account_id: 'acc-cash' };
  const sug = {
    operation_type: 'EXPENSE',
    confidence: 0.91,
    primary_account: { id: 'acc-expense', code: '3.1', name: 'Despesas' },
    bank: { id: 'bank-1', name: 'Caixa' },
    reason: 'Sugestão teste'
  };
  const mapped = engine.accountsFromAiSuggestion(sug, bank, { operation_type: 'DESPESA' });
  assert.ok(mapped);
  assert.equal(mapped.debit_account_id, 'acc-expense');
  assert.equal(mapped.credit_account_id, 'acc-cash');
  assert.equal(mapped.primary_account_id, 'acc-expense');
});

test('accountsFromAiSuggestion recusa primary igual ao banco', () => {
  const engine = createDecisionEngine({
    db: { prepare() { return { get: () => null, all: () => [], run: () => ({}) }; } },
    classify: () => ({ status: 'NEEDS_CLASSIFICATION' })
  });
  const bank = { id: 'bank-1', account_id: 'acc-same' };
  const sug = { primary_account: { id: 'acc-same' }, operation_type: 'EXPENSE' };
  assert.equal(engine.accountsFromAiSuggestion(sug, bank, null), null);
});
