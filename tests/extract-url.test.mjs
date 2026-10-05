import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFromCurrentTab, isSupportedExtractionUrl } from '../src/features/jobs/extract.js';

test('extraction only accepts HTTP(S) URLs on supported domains', () => {
  for (const url of [
    'https://www.zhipin.com/job_detail/123.html',
    'https://jobs.zhaopin.com/123',
    'https://www.zhaopin.com/jobs?jl=530&kw=产品经理',
    'https://www.zhaopin.com/beijing/pingmiansheji/',
    'https://www.zhaopin.com/beijing/ruanjianchanpinjingli/?pageMode=recommend&jl=530',
    'http://liepin.com/job/123'
  ]) {
    assert.equal(isSupportedExtractionUrl(url), true, url);
  }
  for (const url of ['chrome://extensions', 'chrome://newtab', 'edge://extensions', 'about:blank', 'file:///tmp/jd.html', 'https://example.com', 'https://fakezhipin.com', 'https://zhipin.com.example.com', 'https://example.com/?url=zhipin.com', undefined, '']) {
    assert.equal(isSupportedExtractionUrl(url), false, String(url));
  }
});

test('unsupported tabs are rejected before messaging or script injection', async () => {
  const previousChrome = globalThis.chrome;
  const previousWindow = globalThis.window;
  let calls = 0;
  let tab = { id: 1, url: 'chrome://extensions' };
  globalThis.chrome = {
    runtime: {},
    tabs: { query: (_options, done) => done([tab]), sendMessage: () => { calls++; } },
    scripting: { executeScript: () => { calls++; } }
  };
  globalThis.window = { chrome: globalThis.chrome };
  try {
    await assert.rejects(extractFromCurrentTab(), /当前网址不支持提取岗位.*手动添加岗位/);
    tab = { id: 1, url: 'https://www.zhipin.com', pendingUrl: 'chrome://extensions' };
    await assert.rejects(extractFromCurrentTab(), /当前网址不支持/);
    assert.equal(calls, 0);
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.window = previousWindow;
  }
});

test('Edge-style tabs without URL resolve location through the permitted page before extraction', async () => {
  const previousChrome = globalThis.chrome;
  const previousWindow = globalThis.window;
  let injectedContent = false;
  globalThis.chrome = {
    runtime: {},
    tabs: {
      query: (_options, done) => done([{ id: 1 }]),
      sendMessage: (_tabId, _message, done) => done(injectedContent
        ? { ok: true, job: { title: 'AI 产品专家' } }
        : { ok: true, job: { title: 'AI 产品专家' } })
    },
    scripting: {
      executeScript: (options, done) => {
        if (options.func) done([{ result: 'https://www.zhipin.com/web/geek/jobs' }]);
        else { injectedContent = true; done([]); }
      }
    }
  };
  globalThis.window = { chrome: globalThis.chrome };
  try {
    assert.deepEqual(await extractFromCurrentTab(), { title: 'AI 产品专家' });
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.window = previousWindow;
  }
});

test('a tab whose URL cannot be resolved reports an access problem', async () => {
  const previousChrome = globalThis.chrome;
  const previousWindow = globalThis.window;
  globalThis.chrome = {
    runtime: {},
    tabs: { query: (_options, done) => done([{ id: 1 }]) },
    scripting: {}
  };
  globalThis.window = { chrome: globalThis.chrome };
  try {
    await assert.rejects(extractFromCurrentTab(), /暂时无法读取当前网页.*刷新招聘页面/);
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.window = previousWindow;
  }
});
