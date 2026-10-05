import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installStorage } from './helpers.mjs';
import { getSettings, restoreDefaultSettings, saveSettings, testApiKey } from '../src/features/settings/service.js';
import { postResponses, responsesUrl, validateModelSettings } from '../src/shared/ai/client.js';
import { readFile } from 'node:fs/promises';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; delete globalThis.document; });
function form(baseUrl = '', model = '', apiKey = '') {
  const fields = Object.fromEntries(Object.entries({ baseUrl, modelName: model, apiKey }).map(([id, value]) => [`#${id}`, { value }]));
  fields['#apiStatus'] = { classList: { add() {} } };
  fields['#currentServiceStatus'] = { textContent: '' };
  fields['#testApiBtn'] = {};
  globalThis.document = { querySelector: id => fields[id] };
  return fields;
}
test('保存自定义配置，清空恢复托管；Key 不长期落盘', async () => {
  const storage = installStorage();
  form('https://example.test/v1', 'my-model', 'user-test-api-key');
  await saveSettings();
  assert.equal((await getSettings()).mode, 'custom');
  assert.equal(storage.read('rolemi.settings').apiKey, undefined);
  sessionStorage.setItem('rolemi.apiKey.session', '""');
  assert.throws(() => validateModelSettings({ mode: 'custom', apiType: 'responses', baseUrl: 'https://example.test/v1', model: 'my-model', apiKey: '' }), /API Key/);
  assert.equal((await getSettings()).mode, 'custom');
  form();
  await saveSettings();
  assert.equal((await getSettings()).mode, 'hosted');
});
test('恢复默认服务入口清空自定义配置与会话密钥', async () => {
  const storage = installStorage();
  const fields = form('https://example.test/v1', 'my-model', 'user-test-api-key');
  await saveSettings();
  await restoreDefaultSettings();
  assert.equal((await getSettings()).mode, 'hosted');
  assert.equal(sessionStorage.getItem('rolemi.apiKey.session'), '""');
  assert.equal(fields['#baseUrl'].value, '');
  assert.equal(fields['#modelName'].value, '');
  assert.equal(fields['#apiKey'].value, '');
  assert.equal(fields['#currentServiceStatus'].textContent, '当前使用默认服务');
  assert.equal(storage.read('rolemi.settings').mode, 'hosted');
});
test('服务设置界面使用明确文案并提供恢复入口', async () => {
  const html = await readFile(new URL('../src/popup.html', import.meta.url), 'utf8');
  for (const text of ['服务设置', '需要使用自己的模型服务时，再填写下面的配置。', '当前使用默认服务', 'API 地址', '模型名称', '恢复默认服务', '自定义服务目前需兼容 Responses API']) {
    assert.ok(html.includes(text));
  }
  assert.match(html, /id="restoreDefaultServiceBtn"/);
});
test('部分填写和 Chat Completions 地址均不覆盖已有配置', async () => {
  const storage = installStorage();
  form('https://example.test/v1', '', 'user-test-api-key');
  await assert.rejects(saveSettings(), /模型名称/);
  form('https://example.test/v1/chat/completions', 'model', 'user-test-api-key');
  await assert.rejects(saveSettings(), /仅支持 Responses API/);
  assert.equal(storage.read('rolemi.settings'), null);
});
test('Responses URL 只接受 Base URL 或完整端点', () => {
  assert.equal(responsesUrl('https://example.test/v1'), 'https://example.test/v1/responses');
  assert.equal(responsesUrl('https://example.test/v1/responses/'), 'https://example.test/v1/responses');
  assert.throws(() => responsesUrl('https://example.test/v1/chat/completions'), /仅支持 Responses API/);
});
test('reasoning 不兼容时只去除参数重试一次，Schema 不兼容时明确报错', async () => {
  const settings = { mode: 'custom', provider: '', apiType: 'responses', baseUrl: 'https://example.test/v1', model: 'my-model', apiKey: 'user-test-api-key' };
  const sent = [];
  globalThis.fetch = async (_url, options) => {
    sent.push(JSON.parse(options.body));
    if (sent.length === 1) return new Response('{"error":"unsupported reasoning effort"}', { status: 422 });
    return Response.json({ status: 'completed', output_text: 'ok' });
  };
  await postResponses({ label: 'settings-test', settings, body: { model: settings.model, messages: [{ role: 'user', content: 'test' }], reasoning_effort: 'low' }, errorPrefix: '连接失败' });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].reasoning.effort, 'low');
  assert.equal(sent[1].reasoning, undefined);

  globalThis.fetch = async () => new Response('{"error":"json_schema is unsupported"}', { status: 400 });
  await assert.rejects(postResponses({ label: 'settings-test', settings, body: {
    model: settings.model, messages: [{ role: 'user', content: 'test' }],
    json_schema_format: { name: 'test', schema: { type: 'object' } }
  }, errorPrefix: '连接失败' }), /不兼容 Responses API 结构化输出/);
});
test('测试自定义 API 直连 responses，验证响应且不保存配置', async () => {
  const storage = installStorage();
  const fields = form('https://example.test/v1', 'my-model', 'user-test-api-key');
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://example.test/v1/responses');
    assert.equal(options.headers.Authorization, 'Bearer user-test-api-key');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'my-model');
    assert.ok(body.input);
    assert.equal(body.messages, undefined);
    return { ok: true, json: async () => ({ status: 'completed', output_text: '{"ok":true}' }) };
  };
  await testApiKey();
  assert.equal(calls, 1);
  assert.match(fields['#apiStatus'].textContent, /通过/);
  assert.equal(storage.read('rolemi.settings'), null);
  globalThis.fetch = async () => { throw new Error('offline'); };
  await testApiKey();
  assert.match(fields['#apiStatus'].textContent, /网络请求失败/);
});
