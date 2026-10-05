import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, legacyJob, resumeText, analysisResult, matchResult, responseFor } from './helpers.mjs';
import { getJobs, setJobs } from '../src/features/jobs/repository.js';
import { getResume, saveResumeProfile, setResume } from '../src/features/resume/storage.js';
import { structureResumeText } from '../src/features/resume/extractor.js';
import { buildTaskContext } from '../src/shared/context/builders.js';
import { isResultCurrent, resultMetadata, reusableAnalysis, reusableResumeProfile, taskKey } from '../src/shared/context/cache.js';
import { jobRows } from '../src/features/jobs/export.js';
import { createRequestRegistry } from '../src/shared/context/requests.js';
import { greetingMessages } from '../src/features/greeting/prompt.js';
import { revisionHtml } from '../src/features/resume-match/view.js';

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

test('迁移落盘并保留历史结果，旧结果不自动复用', async () => {
  installStorage({ 'rolemi.jobs': [{ ...legacyJob, deepAnalysis: analysisResult }] });
  const [first] = await getJobs();
  const [second] = await getJobs();
  assert.equal(first.id, second.id);
  assert.match(first.contentVersion, /^[a-f0-9]{64}$/);
  assert.equal(first.contentVersion, second.contentVersion);
  assert.deepEqual(first.deepAnalysis.coreRequirements, analysisResult.coreRequirements);
  assert.equal(reusableAnalysis(first), null);
  assert.equal(first.summary.sourceVersion, first.contentVersion);
});

test('完整正文、其他业务字段参与版本；收藏不改变版本', async () => {
  const { job } = await fixtures();
  const [starred] = await setJobs([{ ...job, starred: true }]);
  assert.equal(starred.contentVersion, job.contentVersion);
  const [long] = await setJobs([{ ...job, description: '岗'.repeat(210) + '旧要求' }]);
  const [changed] = await setJobs([{ ...long, description: '岗'.repeat(210) + '新要求' }]);
  assert.equal(long.id, changed.id);
  assert.notEqual(long.contentVersion, changed.contentVersion);
  assert.equal(reusableAnalysis(changed), null);
  const [salary] = await setJobs([{ ...job, salary: '30K' }]);
  assert.notEqual(salary.contentVersion, job.contentVersion);
});

test('同内容重传保留简历 ID；同文件名不同内容生成新 ID', async () => {
  const { resume } = await fixtures();
  const same = await setResume(structureResumeText(resumeText, { fileName: 'renamed.docx' }));
  assert.equal(same.id, resume.id);
  assert.equal(same.contentVersion, resume.contentVersion);
  assert.equal(reusableResumeProfile(same)?.resultId, reusableResumeProfile(resume)?.resultId);
  const changed = await setResume(structureResumeText(resumeText + '\n负责另一项业务', { fileName: 'renamed.docx' }));
  assert.notEqual(changed.id, same.id);
  assert.notEqual(changed.contentVersion, same.contentVersion);
  assert.equal(reusableResumeProfile(changed), null);
  assert.equal((await getResume()).id, changed.id);
  assert.ok(changed.summary.workExperience[0].id.startsWith(changed.id));
});

test('Match 强依赖有效 Deep Analysis，并只消费 Job Summary 而不回退 Raw JD', async () => {
  const { job, resume } = await fixtures();
  const context = buildTaskContext({ task: 'resume_match', job, resume });
  assert.equal(context.stats.job, 'summary');
  assert.equal(context.input.job.description, undefined);
  assert.deepEqual(context.input.jobSummary.inferredRequirements, analysisResult.hiddenRequirements);
  assert.throws(
    () => buildTaskContext({ task: 'resume_match', job: { ...job, deepAnalysis: null }, resume }),
    /失效|深度分析/
  );
});

test('没有有效 Deep Analysis 时 Resume Match dependency key 不成立', async () => {
  const { job, resume } = await fixtures();
  assert.ok(taskKey('resume_match', { job, resume }));
  assert.equal(taskKey('resume_match', { job: { ...job, deepAnalysis: null }, resume }), '');
});

test('Match 只消费缓存 Resume Profile，不发送 Raw Resume 或联系方式', async () => {
  const { job, resume } = await fixtures();
  const context = buildTaskContext({ task: 'resume_match', job, resume });
  assert.equal(context.stats.resume, 'profile');
  assert.ok(JSON.stringify(context.input.resumeProfile).includes('月活提升40%'));
  assert.ok(!JSON.stringify(context.input).includes('13800000000'));
  assert.ok(!JSON.stringify(context.input).includes('test@example.test'));
  assert.ok(!JSON.stringify(context.input).includes(resume.rawText));

  const noProfile = { ...resume, profile: null };
  assert.equal(taskKey('resume_match', { job, resume: noProfile }), '');
  assert.throws(() => buildTaskContext({ task: 'resume_match', job, resume: noProfile }), /失效|简历理解/);
});

test('开场白加载岗位理解与匹配证据，并保留迁移边界', async () => {
  const { job, resume } = await matchedFixture();
  job.resumeMatch.result.directMatches.push(
    { requirement: '效果评估', experience: '建立效果评估机制', proof: '持续跟踪月活' },
    { requirement: '需求分析', experience: '完成用户调研', proof: '形成需求优先级' }
  );
  job.resumeMatch.result.transferableMatches.push(
    { requirement: '团队管理', experience: '协调算法和研发', ability: '跨团队推进', boundary: '没有正式团队管理经历' }
  );
  const context = buildTaskContext({ task: 'greeting', job, resume, tone: 'professional', maxChars: 260 });
  const text = JSON.stringify(context.input);
  assert.ok(!text.includes(job.description));
  assert.ok(!text.includes(resume.rawText));
  assert.ok(!text.includes('13800000000'));
  assert.ok(!text.includes('revisions'));
  assert.equal(context.input.jobSummary.coreRequirements.length, 2);
  assert.equal(context.input.matchResult.directMatches.length, 3);
  assert.equal(context.input.matchResult.directMatches[0].proof, '月活提升40%');
  const prompt = greetingMessages(context.input)[1].content;
  assert.ok(prompt.includes('持续跟踪月活'));
  assert.ok(prompt.includes('形成需求优先级'));
  assert.ok(prompt.includes('提供更多岗位相关证据和动机'));
  assert.ok(!prompt.includes('260 字'));
  const transferable = structuredClone(job);
  transferable.resumeMatch.result.directMatches = [];
  transferable.resumeMatch.result.transferableMatches = [{ experience: '组织活动', ability: '跨团队推进', boundary: '没有软件上线经验' }];
  assert.equal(buildTaskContext({ task: 'greeting', job: transferable, resume }).input.matchResult.transferableMatches[0].boundary, '没有软件上线经验');
  transferable.resumeMatch.result.transferableMatches = [];
  assert.deepEqual(buildTaskContext({ task: 'greeting', job: transferable, resume }).input.matchResult.transferableMatches, []);
});

test('修改建议 category 在 UI 标题区域显示为标签', () => {
  const html = revisionHtml({
    category: '岗位相关性',
    summary: '突出与核心要求相关的经验',
    original: '参与内部工具开发',
    rewrite: '参与内部工具开发并负责需求梳理与上线验证',
    reason: '与岗位的产品落地要求相关'
  }, 0);
  assert.ok(html.includes('revision-category'));
  assert.ok(html.includes('岗位相关性'));
});

test('匹配与开场白按依赖版本失效，语气变化仅影响开场白', async () => {
  let { job, resume } = await matchedFixture();
  const context = buildTaskContext({ task: 'greeting', job, resume, tone: 'natural', maxChars: 120 });
  [job] = await setJobs([{ ...job, greeting: { ...resultMetadata(context), tone: 'natural', maxChars: 120, result: { greeting: '您好' } } }]);
  assert.ok(isResultCurrent('resume_match', job.resumeMatch, { job, resume }));
  assert.ok(isResultCurrent('greeting', job.greeting, { job, resume, tone: 'natural', maxChars: 120 }));
  assert.ok(!isResultCurrent('greeting', job.greeting, { job, resume, tone: 'warm', maxChars: 120 }));
  const replaced = { ...resume, contentVersion: 'other-version' };
  assert.ok(!isResultCurrent('resume_match', job.resumeMatch, { job, resume: replaced }));
  assert.equal(jobRows([job], replaced)[0]['求职开场白'], '');
  assert.equal(jobRows([job], resume)[0]['求职开场白'], '您好');
  const rerun = { ...job, resumeMatch: { ...job.resumeMatch, resultId: 'new-match' } };
  assert.ok(!isResultCurrent('greeting', rerun.greeting, { job: rerun, resume }));
  const analysisRerun = { ...job, deepAnalysis: { ...job.deepAnalysis, resultId: 'new-analysis' } };
  assert.ok(!isResultCurrent('resume_match', job.resumeMatch, { job: analysisRerun, resume }));
  const oldPrompt = { ...job.resumeMatch, dependencies: { ...job.resumeMatch.dependencies, promptVersion: 0 } };
  assert.ok(!isResultCurrent('resume_match', oldPrompt, { job, resume }));
});

test('进行中请求按岗位隔离，重试和清除使旧请求失效', () => {
  const registry = createRequestRegistry();
  const a = registry.start('resume_match', 'a', 'v1');
  const b = registry.start('resume_match', 'b', 'v1');
  assert.ok(registry.isCurrent(a));
  assert.ok(registry.isCurrent(b));
  registry.start('resume_match', 'a', 'v2');
  assert.ok(!registry.isCurrent(a));
  assert.ok(registry.isCurrent(b));
  registry.invalidate();
  assert.ok(!registry.isCurrent(b));
});

test('实际 API 请求使用独立 Context；超长材料不调用网络', async () => {
  const { job, resume } = await matchedFixture();
  const { analyzeResumeMatchWithAi } = await import('../src/features/resume-match/service.js');
  const { analyzeJobWithAi } = await import('../src/features/jd-analysis/service.js');
  const { generateGreetingWithAi } = await import('../src/features/greeting/service.js');
  const settings = { apiKey: 'fake-test-key-value', model: 'test-model', baseUrl: 'https://example.test/v1' };
  const sent = [];
  const longGreeting = '您好，想了解产品经理岗位。'.repeat(20);
  globalThis.fetch = async (_url, request) => { sent.push(JSON.parse(request.body)); return responseFor({ greeting: longGreeting }); };
  const greetingResult = await generateGreetingWithAi({ job, resume, settings, tone: 'natural', maxChars: 120 });
  assert.equal(greetingResult.greeting, longGreeting);
  assert.equal(sent[0].input.length, 2);
  assert.ok(!JSON.stringify(sent[0]).includes(job.description));
  assert.ok(!JSON.stringify(sent[0]).includes('previous_response_id'));
  const longRawJob = { ...job, contentVersion: 'long-job', description: '字'.repeat(5001), deepAnalysis: null, summary: null };
  await assert.rejects(analyzeJobWithAi(longRawJob, settings), /5000/);
  assert.equal(sent.length, 1);
});

test('Resume Profile 可用时，未发送的长 Raw Resume 不阻断匹配', async () => {
  const { job, resume } = await fixtures();
  const { analyzeResumeMatchWithAi } = await import('../src/features/resume-match/service.js');
  const settings = { apiKey: 'fake-test-key-value', model: 'test-model', baseUrl: 'https://example.test/v1' };
  const longJob = { ...job, description: `${job.description}${'补'.repeat(5001)}` };
  const longResume = { ...resume, rawText: `${resume.rawText}\n${'补充'.repeat(1600)}` };
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return requestCount === 1
      ? responseFor({ overall: { level: '高匹配', reason: '能力匹配' }, directMatches: [], transferableMatches: [], gaps: [] })
      : responseFor({ revisions: [] });
  };
  const context = buildTaskContext({ task: 'resume_match', job: longJob, resume: longResume });
  assert.equal(context.stats.job, 'summary');
  assert.equal(context.stats.resume, 'profile');
  await analyzeResumeMatchWithAi({ job: longJob, resume: longResume, settings, context });
  assert.equal(requestCount, 1);
});

test('常见列式简历可识别分行日期、公司职位和标题同行内容', () => {
  const parsed = structureResumeText([
    '张三',
    '求职意向：产品经理',
    '工作经历',
    '2021.03 - 2024.06',
    '某科技公司    高级产品经理',
    '• 负责企业产品规划，推动上线并提升转化率 20%',
    '专业技能：需求分析、数据分析'
  ].join('\n'), { fileName: 'layout.pdf' });
  assert.equal(parsed.basicInfo.jobIntent, '产品经理');
  assert.equal(parsed.workExperience[0].organization, '某科技公司');
  assert.equal(parsed.workExperience[0].role, '高级产品经理');
  assert.deepEqual(parsed.skills, ['需求分析', '数据分析']);
});

test('匹配分析与修改建议是两个独立 AI service', async () => {
  const { job, resume } = await fixtures();
  const { analyzeResumeMatchWithAi } = await import('../src/features/resume-match/service.js');
  const { generateResumeRevisions } = await import('../src/features/resume-revision/service.js');
  const settings = { apiKey: 'fake-test-key-value', model: 'test-model', baseUrl: 'https://example.test/v1' };
  const sent = [];
  globalThis.fetch = async (_url, request) => {
    const body = JSON.parse(request.body);
    sent.push(body);
    if (sent.length === 1) return responseFor({
      overall: { level: '高匹配', reason: '具备相关经验' },
      directMatches: matchResult.directMatches, transferableMatches: [], gaps: []
    });
    return responseFor({ revisions: matchResult.revisions });
  };
  const context = buildTaskContext({ task: 'resume_match', job, resume });
  const match = await analyzeResumeMatchWithAi({ job, resume, settings, context });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text.format.name, 'resume_match_analysis');
  assert.equal(match.level, '高匹配');
  assert.deepEqual(match.revisions, []);

  const revision = await generateResumeRevisions({ settings, resumeProfile: context.input.resumeProfile, matchResult: match, job });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].text.format.name, 'resume_revision_suggestions');
  assert.equal(sent[0].reasoning?.effort, 'none');
  assert.equal(sent[1].reasoning?.effort, 'low');
  const revisionPrompt = sent[1].input.map((item) => item.content).join('\n');
  assert.ok(!revisionPrompt.includes('岗位信息：'));
  assert.ok(revisionPrompt.includes('## Target Job'));
  assert.ok(revisionPrompt.includes(JSON.stringify({ title: job.title })));
  assert.equal(revision.revisions.length, 1);
});

test('修改建议失败不会改变已经成功的匹配结果', async () => {
  const { job, resume } = await fixtures();
  const { analyzeResumeMatchWithAi } = await import('../src/features/resume-match/service.js');
  const { generateResumeRevisions } = await import('../src/features/resume-revision/service.js');
  const settings = { apiKey: 'fake-test-key-value', model: 'test-model', baseUrl: 'https://example.test/v1' };
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) return responseFor({
      overall: { level: '中高匹配', reason: '核心能力匹配' }, directMatches: [], transferableMatches: [], gaps: []
    });
    return { ok: false, status: 500, text: async () => 'temporary failure' };
  };
  const context = buildTaskContext({ task: 'resume_match', job, resume });
  const match = await analyzeResumeMatchWithAi({ job, resume, settings, context });
  assert.equal(match.level, '中高匹配');
  await assert.rejects(generateResumeRevisions({ settings, resumeProfile: context.input.resumeProfile, matchResult: match }), /修改建议生成失败/);
  assert.equal(match.level, '中高匹配');
  assert.deepEqual(match.revisions, []);
});

test('Revision Prompt 使用 Suggestion Gate 并禁止用改写消除真实经历缺口', async () => {
  const { generateResumeRevisions } = await import('../src/features/resume-revision/service.js');
  const settings = { apiKey: 'fake-test-key-value', model: 'test-model', baseUrl: 'https://example.test/v1' };
  let sent;
  globalThis.fetch = async (_url, request) => {
    sent = JSON.parse(request.body);
    return responseFor({ revisions: [] });
  };
  await generateResumeRevisions({
    settings,
    resumeProfile: { projects: [{ name: 'RAG', details: '搭建知识库检索' }] },
    matchResult: { directMatches: [], transferableMatches: [], gaps: [{ requirement: '酒店餐饮行业经验', gap: '无相关经历' }] }
  });
  const prompt = sent.input.map((item) => item.content).join('\n');
  assert.ok(prompt.includes('Suggestion Gate'));
  assert.ok(prompt.includes('Match 明确缺失且 Resume Profile 无相关线索的问题，不进入 Revision'));
  assert.ok(prompt.includes('不得升级责任范围或经历性质'));
  assert.ok(prompt.includes('不得将候选人的业务对象、流程或场景替换为 JD 的目标业务'));
  assert.ok(prompt.includes('经历补充'));
  assert.ok(prompt.includes('rewrite 必须为空'));
  assert.deepEqual(sent.text.format.schema.properties.revisions.items.properties.category.enum, ['事实优化', '策略强化', '经历补充']);
});

test('non-JD results remain reusable but block matching and greeting contexts', async () => {
  const { job, resume } = await fixtures();
  const blocked = { ...job, deepAnalysis: { ...job.deepAnalysis, isJobDescription: false, nonJdReason: '这是 API 文档' } };
  assert.ok(reusableAnalysis(blocked));
  assert.equal(taskKey('resume_match', { job: blocked, resume }), '');
  assert.equal(taskKey('greeting', { job: blocked, resume }), '');
  assert.throws(() => buildTaskContext({ task: 'resume_match', job: blocked, resume }));
});
