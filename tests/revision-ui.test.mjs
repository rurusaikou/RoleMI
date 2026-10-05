import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, legacyJob, resumeText, analysisResult, matchResult, responseFor, until } from './helpers.mjs';
import { setJobs } from '../src/features/jobs/repository.js';
import { saveResumeProfile, setResume } from '../src/features/resume/storage.js';
import { structureResumeText } from '../src/features/resume/extractor.js';
import { buildTaskContext } from '../src/shared/context/builders.js';
import { resultMetadata } from '../src/shared/context/cache.js';
import { runResumeRevision } from '../src/app/task-runner.js';
import { state, requests } from '../src/app/runtime.js';
import { renderResumeMatchView } from '../src/features/resume-match/view.js';

async function fixtures() {
  installStorage();
  let [job] = await setJobs([legacyJob]);
  let resume = await setResume(structureResumeText(resumeText, { fileName: 'cv.pdf' }));
  resume = await saveResumeProfile(resume, {
    jobIntent: '产品经理',
    location: '',
    education: [],
    workExperience: [{ organization: '公司A', role: '', period: '2022.01-2024.01', details: ['负责知识库产品规划并协同算法研发完成上线，月活提升40%。'], technologies: [] }],
    projects: [{ name: '知识库产品', role: '', period: '2022.01-2024.01', organization: '公司A', details: ['负责知识库产品规划并协同算法研发完成上线，月活提升40%。'], technologies: [] }],
    skills: ['需求分析', '跨团队合作', '效果评估'],
    certifications: [], languages: [], otherEvidence: []
  });
  const context = buildTaskContext({ task: 'deep_analysis', job });
  [job] = await setJobs([{ ...job, deepAnalysis: { ...analysisResult, ...resultMetadata(context) } }]);
  return { job, resume };
}

async function matchedFixture() {
  const { job, resume } = await fixtures();
  const context = buildTaskContext({ task: 'resume_match', job, resume });
  const [matched] = await setJobs([{ ...job, resumeMatch: { ...resultMetadata(context), result: matchResult } }]);
  return { job: matched, resume };
}


test('修改建议重试复用 Match，重复点击只发一个请求', async () => {
  const { job, resume } = await matchedFixture();
  state.jobs = [job];
  state.resumeState.data = resume;
  requests.invalidate();
  const originalFetch = globalThis.fetch;
  const originalChrome = globalThis.chrome;
  globalThis.chrome = { runtime: { id: "test", async sendMessage() { return { installation_id: "test-installation" }; } } };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(JSON.parse(options.body).module, 'resume_revision');
    await gate;
    return responseFor({ revisions: [] });
  };
  try {
    const pending = runResumeRevision(job);
    await runResumeRevision(job);
    release();
    await pending;
    assert.equal(calls, 1, JSON.stringify(state.jobs[0].resumeMatch.result));
    assert.equal(state.jobs[0].resumeMatch.resultId, job.resumeMatch.resultId);
    assert.equal(state.jobs[0].resumeMatch.result.revisionCompleted, true);
    assert.deepEqual(state.jobs[0].resumeMatch.result.directMatches, job.resumeMatch.result.directMatches);
  } finally { globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; requests.invalidate(); }
});

test('等待主题节点保留，失败可重试，成功后移除等待状态', () => {
  const originalDocument = globalThis.document;
  const nodes = new Map();
  globalThis.document = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', classList: { toggle() {}, remove() {}, add() {} }, style: {}, parentElement: { dataset: {} }, querySelector() { return this.innerHTML.includes('revision-waiting') ? {} : null; } });
    return nodes.get(selector);
  }};
  const viewState = { resumeState: { uploaded: true, data: null }, tasks: { resumeMatch: { status: 'success', result: { ...matchResult, revisions: [] } }, resumeRevision: { status: 'loading' }, deepAnalysis: { status: 'success' } } };
  try {
    renderResumeMatchView(viewState);
    const list = nodes.get('#suggestList');
    assert.match(list.innerHTML, /分析主题/);
    list.innerHTML += '<!-- preserved -->';
    renderResumeMatchView(viewState);
    assert.match(list.innerHTML, /preserved/);
    viewState.tasks.resumeRevision = { status: 'error', error: '<模型返回未完成>' };
    renderResumeMatchView(viewState);
    assert.match(list.innerHTML, /retryRevisionBtn/);
    assert.match(list.innerHTML, /重新生成修改意见/);
    assert.match(list.innerHTML, /aria-label="重新生成修改意见"/);
    assert.doesNotMatch(list.innerHTML, /模型返回未完成|可以点击重试/);
    assert.doesNotMatch(list.innerHTML, /revision-waiting/);
    viewState.tasks.resumeRevision.status = 'success';
    viewState.tasks.resumeMatch.result.revisionCompleted = true;
    renderResumeMatchView(viewState);
    assert.match(list.innerHTML, /暂无修改建议/);
    assert.doesNotMatch(list.innerHTML, /retryRevisionBtn/);
  } finally { globalThis.document = originalDocument; }
});

test('修改建议完成时保留用户正在展开的匹配结果', () => {
  const originalDocument = globalThis.document;
  const nodes = new Map();
  globalThis.document = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', classList: { toggle() {}, remove() {}, add() {} }, style: {}, parentElement: { dataset: {} }, querySelector() { return null; } });
    return nodes.get(selector);
  }};
  const viewState = { resumeState: { uploaded: true, data: null }, tasks: { resumeMatch: { status: 'success', result: { ...matchResult, revisions: [] } }, resumeRevision: { status: 'loading' }, deepAnalysis: { status: 'success' } } };
  try {
    renderResumeMatchView(viewState);
    const matchList = nodes.get('#matchList');
    matchList.innerHTML += '<!-- open-disclosure-preserved -->';

    viewState.tasks.resumeRevision = { status: 'success' };
    viewState.tasks.resumeMatch.result.revisionCompleted = true;
    viewState.tasks.resumeMatch.result.revisions = [{ summary: '突出成果', reason: '补充业务结果' }];
    renderResumeMatchView(viewState);

    assert.match(matchList.innerHTML, /open-disclosure-preserved/);
    assert.match(nodes.get('#suggestList').innerHTML, /突出成果/);
  } finally { globalThis.document = originalDocument; }
});

for (const fail of [false, true]) {
  test(`更换简历后丢弃旧修改建议${fail ? '错误' : '结果'}`, async () => {
    const { job, resume } = await matchedFixture();
    state.jobs = [job];
    state.resumeState.data = resume;
    requests.invalidate();
    const originalFetch = globalThis.fetch;
    const originalChrome = globalThis.chrome;
    globalThis.chrome = { runtime: { id: 'test', async sendMessage() { return { installation_id: 'test-installation' }; } } };
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    let started = false;
    globalThis.fetch = async () => {
      started = true;
      await gate;
      if (fail) throw new Error('offline');
      return responseFor({ revisions: [] });
    };
    try {
      const pending = runResumeRevision(job);
      await until(() => started);
      state.resumeState.data = { ...resume, contentVersion: 'replacement' };
      release();
      await pending;
      assert.deepEqual(state.jobs[0].resumeMatch, job.resumeMatch);
    } finally { release(); globalThis.fetch = originalFetch; globalThis.chrome = originalChrome; requests.invalidate(); }
  });
}
