import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, responseFor } from './helpers.mjs';
import { structureResumeText } from '../src/features/resume/extractor.js';
import { saveResumeProfile, setResume } from '../src/features/resume/storage.js';
import { reusableResumeProfile } from '../src/shared/context/cache.js';
import { buildResumeProfileWithAi } from '../src/features/resume/profile-service.js';
import { parseResumeProfileResponse } from '../src/features/resume/profile-response.js';
import { MODEL_REASONING_EFFORT, MODEL_TOKEN_LIMITS } from '../src/shared/ai/token-limits.js';

const settings = { apiKey: 'fake-test-key-value', model: 'test-model', baseUrl: 'https://example.test/v1' };

test('validResume 为 false 时拒绝残留履历字段，不能保存为有效 Profile', () => {
  assert.throws(
    () => parseResumeProfileResponse({ output_text: JSON.stringify({
      validResume: false,
      jobIntent: '', location: '', education: [],
      workExperience: [{ organization: '误识别内容', role: '', period: '', details: ['残留'], technologies: [] }],
      projects: [], skills: ['误识别技能'], certifications: [], languages: [], otherEvidence: []
    }) }),
    /无法识别为简历/
  );
});

test('Resume Understanding 关闭额外 reasoning、使用紧凑输出预算，并把非标准科研项目结构化为 projects', async () => {
  installStorage();
  let resume = await setResume(structureResumeText([
    '测试用户',
    '产品工作',
    '某银行浏览器迁移 系统工程师 2024.10—2025.08',
    '分析30余个业务页面，推动Edge迁移。',
    '科研项目',
    '知识图谱平台 项目负责人 2021.12—2023.03',
    '负责需求分析、甲方沟通，基于BERT生成3.5万条关系并存储至Neo4j。'
  ].join('\n'), { fileName: 'cv.docx' }));

  const sent = [];
  globalThis.fetch = async (_url, request) => {
    sent.push(JSON.parse(request.body));
    return responseFor({
      jobIntent: '', location: '', education: [],
      workExperience: [{ organization: '某银行', role: '系统工程师', period: '2024.10—2025.08', details: ['分析30余个业务页面，推动Edge迁移。'], technologies: ['Edge'] }],
      projects: [
        { name: '某银行浏览器迁移', role: '系统工程师', period: '2024.10—2025.08', organization: '某银行', details: ['分析30余个业务页面，推动Edge迁移。'], technologies: ['Edge'] },
        { name: '知识图谱平台', role: '项目负责人', period: '2021.12—2023.03', organization: '', details: ['负责需求分析、甲方沟通，基于BERT生成3.5万条关系并存储至Neo4j。'], technologies: ['BERT', 'Neo4j'] }
      ],
      skills: [], certifications: [], languages: [], otherEvidence: []
    });
  };

  const profileData = await buildResumeProfileWithAi({ resume, settings });
  resume = await saveResumeProfile(resume, profileData);
  const profile = reusableResumeProfile(resume);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].reasoning?.effort, MODEL_REASONING_EFFORT.resumeProfile);
  assert.equal(MODEL_REASONING_EFFORT.resumeProfile, 'none');
  assert.equal(sent[0].max_output_tokens, MODEL_TOKEN_LIMITS.resumeProfile.outputTokens);
  assert.equal(MODEL_TOKEN_LIMITS.resumeProfile.outputTokens, 4000);
  assert.equal(profile.projects.length, 2);
  assert.ok(profile.projects.some((item) => item.name === '知识图谱平台'));
  assert.ok(JSON.stringify(profile).includes('3.5万条关系'));
  assert.ok(!JSON.stringify(profile).includes('测试用户'));
});

test('同一 Resume contentVersion 可复用 Profile；内容变化后 Profile 自动失效', async () => {
  installStorage();
  let resume = await setResume(structureResumeText('工作经历\n2022.01-2024.01 公司A 产品经理\n负责产品上线。', { fileName: 'a.docx' }));
  resume = await saveResumeProfile(resume, {
    jobIntent: '', location: '', education: [],
    workExperience: [{ organization: '公司A', role: '产品经理', period: '2022.01-2024.01', details: ['负责产品上线。'], technologies: [] }],
    projects: [], skills: [], certifications: [], languages: [], otherEvidence: []
  });
  const firstId = reusableResumeProfile(resume).resultId;

  const same = await setResume(structureResumeText('工作经历\n2022.01-2024.01 公司A 产品经理\n负责产品上线。', { fileName: 'renamed.docx' }));
  assert.equal(reusableResumeProfile(same).resultId, firstId);

  const changed = await setResume(structureResumeText('工作经历\n2022.01-2024.01 公司A 产品经理\n负责产品上线并优化转化率。', { fileName: 'renamed.docx' }));
  assert.equal(reusableResumeProfile(changed), null);
});

test('内容变化时即使调用方携带旧 Profile，也不会写入新 Resume Version', async () => {
  installStorage();
  let resume = await setResume(structureResumeText('工作经历\n公司A 产品经理\n负责旧版本。', { fileName: 'a.docx' }));
  resume = await saveResumeProfile(resume, {
    jobIntent: '', location: '', education: [],
    workExperience: [{ organization: '公司A', role: '产品经理', period: '', details: ['负责旧版本。'], technologies: [] }],
    projects: [], skills: [], certifications: [], languages: [], otherEvidence: []
  });
  const oldProfile = resume.profile;

  const changed = await setResume({
    ...resume,
    rawText: '工作经历\n公司A 产品经理\n负责全新版本。',
    workExperience: [{ organization: '公司A', role: '产品经理', period: '', details: ['负责全新版本。'], technologies: [] }],
    profile: oldProfile
  });

  assert.notEqual(changed.contentVersion, oldProfile.sourceVersion);
  assert.equal(changed.profile, null);
  assert.equal(reusableResumeProfile(changed), null);
});
