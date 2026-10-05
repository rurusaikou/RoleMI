import test from 'node:test';
import assert from 'node:assert/strict';
import { createManualJob } from '../src/features/jobs/manual.js';
import { appendUniqueJob, setJobs, getJobs } from '../src/features/jobs/repository.js';
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
