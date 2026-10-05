import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, resumeText } from './helpers.mjs';
import { structureResumeText } from '../src/features/resume/extractor.js';
import { setResume, saveResumeProfile, getResume } from '../src/features/resume/storage.js';
import { resumeBlockingMessage, isInvalidResume, reusableResumeProfile } from '../src/shared/context/cache.js';
import { runResumePipeline, runResumeUnderstanding, runGreeting } from '../src/app/task-runner.js';
import { state } from '../src/app/runtime.js';
import { renderResumeMatchView } from '../src/features/resume-match/view.js';

test('non-resume persists, blocks all requests and resets on replacement', async () => {
  installStorage();
  const resume = await setResume(structureResumeText(resumeText, { fileName: 'doc.pdf' }));
  await saveResumeProfile(resume, { validResume: false });
  state.resumeState.data = await getResume();
  assert.equal(isInvalidResume(state.resumeState.data), true);
  assert.equal(reusableResumeProfile(state.resumeState.data), null);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected API call'); };
  try {
    assert.equal(await runResumeUnderstanding(), false);
    await runResumePipeline({ id: 'job' });
    await runGreeting({ id: 'job', contentVersion: 'v1' }, {});
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
  const replacement = await setResume(structureResumeText(resumeText + '\n新增项目经历', { fileName: 'resume.pdf' }));
  assert.equal(isInvalidResume(replacement), false);
  assert.equal(replacement.profile, null);
});

test('non-resume match screen shows rejection and disables downstream actions', () => {
  const nodes = new Map();
  const originalDocument = globalThis.document;
  globalThis.document = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, { classList: { toggle() {}, remove() {}, add() {} }, style: {}, parentElement: { dataset: {} } });
    return nodes.get(selector);
  }};
  try {
    renderResumeMatchView({
      resumeState: { uploaded: true, data: { contentVersion: 'v', profile: { validResume: false, sourceVersion: 'v' } } },
      tasks: { resumeMatch: { status: 'idle', result: null }, resumeRevision: { status: 'idle' }, deepAnalysis: { status: 'idle' } }
    });
    assert.equal(nodes.get('#analyzeResumeMatchBtn').disabled, true);
    assert.equal(nodes.get('#toRevisionBtn').disabled, true);
    assert.equal(nodes.get('#toGreetingBtn').disabled, true);
    assert.equal(nodes.get('#matchScore').textContent, '无法匹配');
  } finally { globalThis.document = originalDocument; }
});

test('4000 characters allowed; 4001 blocks understanding and all downstream API calls even with cached profile', async () => {
  assert.equal(resumeBlockingMessage({ rawText: '字'.repeat(4000) }), '');
  assert.match(resumeBlockingMessage({ rawText: '字'.repeat(4001) }), /超过 4000 字/);
  installStorage();
  const resume = await setResume(structureResumeText('字'.repeat(4001), { fileName: 'long.pdf' }));
  state.resumeState.data = await saveResumeProfile(resume, { skills: ['已有缓存'] });
  assert.equal(reusableResumeProfile(state.resumeState.data), null);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('unexpected API call'); };
  try {
    assert.equal(await runResumeUnderstanding(), false);
    await runResumePipeline({ id: 'job', contentVersion: 'v' });
    await runGreeting({ id: 'job', contentVersion: 'v' }, {});
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
