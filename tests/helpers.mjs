export function memoryStorage(seed = {}) {
  const data = new Map(Object.entries(seed).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    read: (key) => JSON.parse(data.get(key) || 'null')
  };
}

export function installStorage(seed = {}) {
  globalThis.localStorage = memoryStorage(seed);
  globalThis.sessionStorage = memoryStorage({ 'rolemi.apiKey.session': 'test-api-key-not-real' });
  globalThis.window = { localStorage };
  return localStorage;
}

export const legacyJob = {
  title: '产品经理', company: '公司 A', location: '深圳', salary: '20K',
  description: '负责企业知识库产品的规划与上线，要求具备需求分析、跨团队合作与效果评估经验。',
  sourceUrl: 'https://example.test/job/a'
};

export const resumeText = [
  '测试用户', '邮箱 test@example.test 电话 13800000000',
  '求职意向：产品经理',
  '工作经历',
  '2022.01-2024.01 公司A',
  '负责知识库产品规划并协同算法研发完成上线，月活提升40%。',
  '技能特长', '需求分析、跨团队合作、效果评估'
].join('\n');

export const analysisResult = {
  isJobDescription: true, nonJdReason: "",
  essence: ['推动知识库产品落地'], coreRequirements: ['需求分析', '产品上线经验'],
  hiddenRequirements: [{ requirement: '可能需要协调多方资源', basis: '涉及多个团队' }], idealCandidate: ['具备产品落地经验的候选人']
};

export const matchResult = {
  level: '高匹配', reason: '具备相关产品上线经验',
  directMatches: [{ requirement: '知识库产品', experience: '负责知识库规划上线', proof: '月活提升40%' }],
  transferableMatches: [], gaps: [],
  revisions: [{ category: '事实优化', summary: '突出结果', original: '负责知识库产品规划并协同算法研发完成上线，月活提升40%。', reason: '强调上线成果', rewrite: '负责知识库产品规划与上线，月活提升40%。' }]
};

export function responseFor(value) {
  return { ok: true, json: async () => ({ status: 'completed', output_text: JSON.stringify(value), usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } }) };
}

export async function until(condition, label = 'condition') {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out: ${label}`);
}
