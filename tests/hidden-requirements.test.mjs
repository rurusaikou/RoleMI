import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHiddenRequirements } from '../src/shared/context/hidden-requirements.js';
import { parseAnalysisResponse } from '../src/features/jd-analysis/response.js';
import { hiddenRequirementHtml } from '../src/features/jd-analysis/view.js';
import { jdAnalysisToText } from '../src/features/jd-analysis/prompt-text.js';
import { jobRows } from '../src/features/jobs/export.js';
import { getJobs, setJobs } from '../src/features/jobs/repository.js';
import { buildTaskContext } from '../src/shared/context/builders.js';
import { getJobSummary } from '../src/shared/context/summaries.js';
import { dependencyKey, resultMetadata, reusableAnalysis } from '../src/shared/context/cache.js';
import { resumeMatchMessages } from '../src/features/resume-match/prompt.js';
import { analysisResult, installStorage, legacyJob } from './helpers.mjs';

test('JSON response preserves structured hidden requirements, including empty results', () => {
  const parsed = parseAnalysisResponse({ output_text: JSON.stringify(analysisResult) });
  assert.deepEqual(parsed.hiddenRequirements, analysisResult.hiddenRequirements);
  assert.deepEqual(parseAnalysisResponse({ output_text: JSON.stringify({ ...analysisResult, hiddenRequirements: [] }) }).hiddenRequirements, []);
});

test('legacy strings migrate without losing separators or inventing missing basis', () => {
  assert.deepEqual(normalizeHiddenRequirements(['  需要协作 ｜ 跨团队｜共同交付 ', '需要沟通', null, {}, '[object Object]']), [
    { requirement: '需要协作', basis: '跨团队｜共同交付' },
    { requirement: '需要沟通', basis: '' }
  ]);
});

test('Markdown fallback returns structured hidden requirements', () => {
  const parsed = parseAnalysisResponse({ output_text: '岗位本质\n- 推动产品上线\n核心要求\n- 产品规划\n隐形要求\n- 可能需要协调｜多个团队参与\n理想候选人\n- 有产品上线经验' });
  assert.deepEqual(parsed.hiddenRequirements, [{ requirement: '可能需要协调', basis: '多个团队参与' }]);
});

test('view escapes both fields and plain text retains requirement and basis', () => {
  const items = [{ requirement: '<script>bad</script>', basis: '<img src=x onerror=bad>｜协同' }];
  const html = hiddenRequirementHtml(items);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<script>') && !html.includes('<img'));
  assert.ok(hiddenRequirementHtml([]).includes('暂无'));
  const text = jdAnalysisToText(analysisResult);
  assert.ok(text.includes('可能需要协调多方资源｜依据：涉及多个团队'));
  assert.ok(!text.includes('[object Object]'));
});

test('storage, summary, Match prompt and Excel retain structured inference and basis', async () => {
  installStorage();
  let [job] = await setJobs([legacyJob]);
  const context = buildTaskContext({ task: 'deep_analysis', job });
  await setJobs([{ ...job, deepAnalysis: { ...analysisResult, ...resultMetadata(context) } }]);
  [job] = await getJobs();
  assert.deepEqual(job.deepAnalysis.hiddenRequirements, analysisResult.hiddenRequirements);
  const summary = getJobSummary(job);
  assert.deepEqual(summary.analysis.inferredRequirements, analysisResult.hiddenRequirements);
  const prompt = resumeMatchMessages({ job: summary.facts, jobSummary: summary.analysis, resumeProfile: {} });
  assert.ok(prompt[1].content.includes(JSON.stringify(analysisResult.hiddenRequirements)));
  assert.ok(prompt[1].content.includes('basis 不是候选人的经历证据'));
  assert.equal(jobRows([job])[0]['隐形要求'], '可能需要协调多方资源｜依据：涉及多个团队');
});

test('legacy analysis migrates at load but old versions cannot be reused', async () => {
  installStorage();
  let [job] = await setJobs([legacyJob]);
  const metadata = resultMetadata(buildTaskContext({ task: 'deep_analysis', job }));
  metadata.dependencies = { ...metadata.dependencies, promptVersion: 2, summaryVersion: 2 };
  metadata.key = dependencyKey(metadata.dependencies);
  [job] = await setJobs([{ ...job, deepAnalysis: { ...analysisResult, hiddenRequirements: ['需要协作｜跨团队'], ...metadata } }]);
  assert.deepEqual(job.deepAnalysis.hiddenRequirements, [{ requirement: '需要协作', basis: '跨团队' }]);
  assert.equal(reusableAnalysis(job), null);
  assert.equal(job.summary.analysis, null);
});
