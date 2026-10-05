
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAiAnalysis, normalizeStoredDeepAnalysis } from '../src/features/jd-analysis/result.js';
import { DEEP_ANALYSIS_RESPONSE_SCHEMA } from '../src/features/jd-analysis/prompt.js';

test('non-JD classification survives storage and discards invented requirements', () => {
  const result = normalizeAiAnalysis({ isJobDescription: false, nonJdReason: '输入为 API 文档', essence: ['虚构岗位'] });
  assert.equal(result.isJobDescription, false);
  assert.deepEqual(result.essence, []);
  assert.deepEqual(result.coreRequirements, []);
  assert.equal(normalizeStoredDeepAnalysis(result).nonJdReason, '输入为 API 文档');
});

test('classification is required and non-JD empty arrays satisfy schema bounds', () => {
  assert.ok(DEEP_ANALYSIS_RESPONSE_SCHEMA.required.includes('isJobDescription'));
  for (const key of ['essence', 'coreRequirements', 'idealCandidate']) {
    assert.equal(DEEP_ANALYSIS_RESPONSE_SCHEMA.properties[key].minItems, 0);
  }
  assert.throws(() => normalizeAiAnalysis({ isJobDescription: true }));
});

test('strict analysis schema requires exactly the declared fields at every object level', () => {
  function validate(schema) {
    if (schema.type === 'object') {
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort());
      for (const child of Object.values(schema.properties)) validate(child);
    }
    if (schema.items) validate(schema.items);
  }
  validate(DEEP_ANALYSIS_RESPONSE_SCHEMA);
  assert.deepEqual(Object.keys(DEEP_ANALYSIS_RESPONSE_SCHEMA.properties.hiddenRequirements.items.properties), ['requirement', 'basis']);
});
