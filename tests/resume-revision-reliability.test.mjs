import test from 'node:test';
import assert from 'node:assert/strict';
import { responseFor } from './helpers.mjs';
import { generateResumeRevisions } from '../src/features/resume-revision/service.js';

const input = {
  job: { title: '音乐 AI 产品经理', description: 'RAW_JD_NOT_FOR_REVISION' },
  settings: { apiKey: 'fake-test-key-value', model: 'test-model', baseUrl: 'https://example.test/v1' },
  resumeProfile: { projects: [{ name: '知识库', details: ['参与需求梳理'] }] },
  matchResult: { directMatches: [], transferableMatches: [], gaps: [] }
};
const revision = { category: '经历补充', summary: '补充成果', original: '参与需求梳理', reason: '确认是否有可核验成果', rewrite: '' };
const incomplete = { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [{ type: 'reasoning' }] };
const payloadResponse = (payload) => ({ ok: true, json: async () => payload });

for (const [name, payload] of [
  ['额度耗尽且仅返回推理', incomplete],
  ['JSON 未完成', { status: 'completed', output_text: '{"revisions":[' }],
  ['空输出', { status: 'completed', output_text: '  ' }]
]) {
  test(`Revision ${name}后关闭额外 reasoning 并紧凑重试`, async (t) => {
    const sent = [];
    t.mock.method(globalThis, 'fetch', async (_url, request) => {
      sent.push(JSON.parse(request.body));
      return sent.length === 1 ? payloadResponse(payload) : responseFor({ revisions: [revision] });
    });
    const before = structuredClone(input);
    const result = await generateResumeRevisions(input);
    assert.equal(sent.length, 2);
    assert.equal(sent[0].reasoning.effort, 'low');
    assert.equal(sent[0].max_output_tokens, 7000);
    assert.equal(sent[1].reasoning.effort, 'none');
    assert.equal(sent[1].max_output_tokens, 8000);
    assert.doesNotMatch(JSON.stringify(sent[0].input), /Compact Retry/);
    assert.match(JSON.stringify(sent[1].input), /Compact Retry/);
    for (const request of sent) {
      const prompt = JSON.stringify(request.input);
      assert.match(prompt, /Target Job/);
      assert.match(prompt, /音乐 AI 产品经理/);
      assert.doesNotMatch(prompt, /RAW_JD_NOT_FOR_REVISION/);
    }
    assert.match(JSON.stringify(sent[1].input), /rewrite 必须为空/);
    assert.deepEqual(sent[0].text.format, sent[1].text.format);
    assert.deepEqual(result.revisions, [revision]);
    assert.deepEqual(input, before);
  });
}

test('Revision 第二次仍截断时停止，不循环重试', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return payloadResponse(incomplete); });
  await assert.rejects(generateResumeRevisions(input), { code: 'AI_RESPONSE_INCOMPLETE' });
  assert.equal(calls, 2);
});

test('Revision 合法空建议列表直接成功', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return responseFor({ revisions: [] }); });
  assert.deepEqual((await generateResumeRevisions(input)).revisions, []);
  assert.equal(calls, 1);
});

for (const failure of ['network', 'api', 'content_filter']) {
  test(`Revision ${failure} 不触发截断重试`, async (t) => {
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (failure === 'network') throw new Error('offline');
      if (failure === 'api') return { ok: false, status: 401, text: async () => 'Unauthorized' };
      return payloadResponse({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } });
    });
    await assert.rejects(generateResumeRevisions(input));
    assert.equal(calls, 1);
  });
}
