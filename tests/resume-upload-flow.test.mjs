import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('../src/app/controllers/resume-controller.js', import.meta.url);

test('简历上传后前置生成 Resume Profile，但不会自动启动完整 Match', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  const uploadBlock = source.match(/resumeFile"\)\.addEventListener\("change"[\s\S]*?\n  \}\);/)?.[0] || '';

  assert.match(uploadBlock, /runResumeUnderstanding\(/);
  assert.doesNotMatch(uploadBlock, /startResumeMatchAnalysis\(/);
});

test('简历上传或解析错误保存在状态中，刷新后仍可展示', async () => {
  const [stateSource, workflowSource, html] = await Promise.all([
    readFile(new URL('../src/app/state.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/resume/workflow.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/popup.html', import.meta.url), 'utf8')
  ]);
  assert.match(stateSource, /uploadError: null/);
  assert.match(workflowSource, /state\.resumeState\.uploadError = error\.message/);
  assert.match(workflowSource, /if \(state\.resumeState\.uploadError\)/);
  assert.match(html, /id="resumeStatus" role="status" aria-live="polite"/);
});
