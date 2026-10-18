import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisInputChanged, createManualJob, isManualJob, updateManualJob } from '../src/features/jobs/manual.js';
import { appendUniqueJob, removeJobById, replaceJobById, setJobs, getJobs } from '../src/features/jobs/repository.js';
import { hasStaleAnalysis } from '../src/features/jobs/view.js';
import { installStorage } from './helpers.mjs';

test('manual JD validates required text and length while allowing empty metadata', () => {
  assert.throws(() => createManualJob({ description: ' \n ' }), /请粘贴/);
  assert.throws(() => createManualJob({ description: 'a'.repeat(2001) }), /2000/);
  assert.equal(createManualJob({ description: 'a'.repeat(2000) }).description.length, 2000);
  assert.equal(createManualJob({ description: ' 正文 ' }).description, '正文');
});

test('manual JD dedupe preserves different descriptions and existing favorites', () => {
  const original = { ...createManualJob({ title: '产品经理', description: '岗位一' }), starred: true };
  const duplicate = appendUniqueJob([original], createManualJob({ title: '产品经理', description: '岗位一' }));
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.jobs[0].starred, true);
  assert.equal(appendUniqueJob([original], createManualJob({ title: '产品经理', description: '岗位二' })).added, true);
  const bare = createManualJob({ description: '只有正文' });
  assert.equal(appendUniqueJob([bare], bare).added, false);
});

test('manual JD persists with source, metadata and content identity', async () => {
  installStorage();
  const job = createManualJob({ company: ' 公司 · 上海 ', experience: '本科 · 三年', salary: '30K', description: '完整 JD\n要求' });
  const saved = await setJobs([job]);
  const restored = await getJobs();
  assert.equal(restored[0].id, saved[0].id);
  assert.ok(restored[0].contentVersion);
  assert.equal(restored[0].company, '公司 · 上海');
  assert.equal(restored[0].sourceSite, '手动添加');
  assert.equal(restored[0].description, job.description);
});

test('manual job update keeps identity, favorite and derived results without creating another job', async () => {
  installStorage();
  const [stored] = await setJobs([{ ...createManualJob({ title: '旧标题', description: '旧岗位描述内容足够长用于分析' }), starred: true }]);
  const existing = {
    ...stored,
    deepAnalysis: {
      resultId: 'analysis_1',
      key: 'old-key',
      dependencies: { jobId: stored.id, jobVersion: stored.contentVersion },
      essence: ['旧分析']
    }
  };
  const edited = updateManualJob(existing, { title: '新标题', description: '新的岗位描述内容足够长用于分析' });
  const result = replaceJobById([existing], edited);
  const [saved] = await setJobs(result.jobs);

  assert.equal(result.updated, true);
  assert.equal(saved.id, existing.id);
  assert.equal(saved.starred, true);
  assert.equal(saved.deepAnalysis.resultId, 'analysis_1');
  assert.notEqual(saved.contentVersion, existing.contentVersion);
  assert.equal(hasStaleAnalysis(saved), true);
  assert.equal(isManualJob(saved), true);
});

test('manual job unchanged analysis fields keep the current content version and analysis state', async () => {
  installStorage();
  const [stored] = await setJobs([createManualJob({ title: '产品经理', company: '示例公司', description: '保持不变的岗位描述内容足够长' })]);
  const existing = {
    ...stored,
    deepAnalysis: {
      resultId: 'analysis_1',
      key: 'old-key',
      dependencies: { jobId: stored.id, jobVersion: stored.contentVersion },
      essence: ['有效分析']
    }
  };
  const edited = updateManualJob(existing, { title: ' 产品经理 ', company: '示例公司', description: ' 保持不变的岗位描述内容足够长 ' });
  const [saved] = await setJobs(replaceJobById([existing], edited).jobs);

  assert.equal(analysisInputChanged(existing, edited), false);
  assert.equal(saved.contentVersion, existing.contentVersion);
  assert.equal(hasStaleAnalysis(saved), false);
});

test('manual job cannot be edited into a duplicate and delete removes only the selected embedded record', async () => {
  installStorage();
  const jobs = await setJobs([
    { ...createManualJob({ title: '岗位一', description: '相同岗位正文' }), starred: true, resumeMatch: { resultId: 'match_1' } },
    createManualJob({ title: '岗位二', description: '另一个岗位正文' })
  ]);
  const duplicate = updateManualJob(jobs[1], { title: '岗位一', description: '相同岗位正文' });
  assert.equal(replaceJobById(jobs, duplicate).duplicate, true);

  const remaining = removeJobById(jobs, jobs[0].id);
  assert.deepEqual(remaining.map((job) => job.id), [jobs[1].id]);
  assert.equal(remaining[0].title, '岗位二');
});
