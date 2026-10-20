import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const contentScript = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

function node(text = '', selectors = {}, attributes = {}) {
  return {
    innerText: text,
    querySelector(selector) {
      const value = selectors[selector];
      return Array.isArray(value) ? value[0] || null : value || null;
    },
    querySelectorAll(selector) {
      const value = selectors[selector];
      if (!value) return [];
      return Array.isArray(value) ? value : [value];
    },
    getAttribute(name) {
      return attributes[name] || null;
    },
    closest(selector) {
      return attributes.closest && attributes.closest[selector] || null;
    }
  };
}

function extractWithDocument(document, href) {
  let listener;
  const url = new URL(href);
  const context = {
    document,
    location: { hostname: url.hostname, href },
    chrome: { runtime: { onMessage: { addListener(callback) { listener = callback; } } } },
    Date,
    URL
  };
  vm.runInNewContext(contentScript, context);
  let response;
  listener({ type: 'ROLEMI_EXTRACT' }, {}, (value) => { response = value; });
  return response;
}

test('BOSS extracts the right detail and resolves company/location from the matching job card', () => {
  const jobId = 'e7fcf01789a817f60nF629S6EVVQ';
  const detail = node('', {
    '.job-detail-header .job-detail-info .job-name': node('运动健康类 AI 产品经理'),
    '.job-detail-header .job-detail-info .job-salary': node('\ue033\ue036-\ue034\ue031K'),
    '.job-detail-header .tag-list li': [node('上海'), node('1-3年'), node('本科')],
    '.job-detail-body > p.desc': node('负责运动健康类 AI 产品整体规划。'),
    ".job-detail-body a.more-job-btn[href*='/job_detail/']": node('', {}, {
      href: `/job_detail/${jobId}.html?securityId=test`
    })
  });
  const card = node('', {
    '.job-card-footer .boss-name': node('安赋网络'),
    '.job-card-footer .company-location': node('上海·黄浦区')
  });
  const matchingLink = node('', {}, {
    href: `/job_detail/${jobId}.html`,
    closest: { '.job-card-box': card }
  });
  const unrelatedLink = node('', {}, {
    href: '/job_detail/another-job.html',
    closest: { '.job-card-box': node('', {
      '.job-card-footer .boss-name': node('错误公司'),
      '.job-card-footer .company-location': node('错误地点')
    }) }
  });
  const document = node('', {
    '.job-detail-container .job-detail-box': detail,
    ".job-card-box a.job-name[href*='/job_detail/']": [unrelatedLink, matchingLink],
    // 两种结构同时存在时仍必须优先原搜索页路径，不能被新增分支覆盖。
    '.job-banner .job-primary.detail-box': node('', {
      '.info-primary .name h1': node('错误的独立页标题')
    }),
    '.job-keyword-list + .job-sec-text': node('错误的独立页正文')
  });

  const response = extractWithDocument(document, `https://www.zhipin.com/job_detail/${jobId}.html`);
  assert.equal(response.ok, true);
  assert.deepEqual({ ...response.job }, {
    title: '运动健康类 AI 产品经理',
    company: '安赋网络',
    companyIndustry: '',
    companyStage: '',
    companyScale: '',
    location: '上海·黄浦区',
    experience: '1-3年',
    education: '本科',
    salary: '25-30K',
    description: '负责运动健康类 AI 产品整体规划。',
    postedDate: '',
    sourceSite: 'boss直聘',
    sourceUrl: `https://www.zhipin.com/job_detail/${jobId}.html`
  });
});

test('BOSS never borrows company data from an unrelated card', () => {
  const detail = node('', {
    '.job-detail-header .job-detail-info .job-name': node('产品经理'),
    '.job-detail-header .job-detail-info .job-salary': node('20-30K'),
    '.job-detail-header .tag-list li': [node('北京'), node('3-5年'), node('本科')],
    '.job-detail-body > p.desc': node('负责产品规划。'),
    ".job-detail-body a.more-job-btn[href*='/job_detail/']": node('', {}, {
      href: '/job_detail/current.html'
    })
  });
  const unrelatedLink = node('', {}, { href: '/job_detail/other.html' });
  const document = node('', {
    '.job-detail-container .job-detail-box': detail,
    ".job-card-box a.job-name[href*='/job_detail/']": [unrelatedLink]
  });

  const response = extractWithDocument(document, 'https://www.zhipin.com/job_detail/current.html');
  assert.equal(response.ok, true);
  assert.equal(response.job.company, '');
  assert.equal(response.job.location, '北京');
});

test('BOSS extracts description when a new layout wraps or renames the paragraph', () => {
  const detail = node('', {
    '.job-detail-header .job-detail-info .job-name': node('社群销售'),
    '.job-detail-header .job-detail-info .job-salary': node('15-30K'),
    '.job-detail-header .tag-list li': [node('上海'), node('1-3年'), node('大专')],
    '.job-detail-body p': [
      node('上海市闵行区工作地址'),
      node('负责社群运营、客户沟通和销售转化，完成业务目标并持续优化服务流程。')
    ]
  });
  const document = node('', { '.job-detail-container .job-detail-box': detail });
  const response = extractWithDocument(document, 'https://www.zhipin.com/web/geek/jobs');

  assert.equal(response.ok, true);
  assert.equal(response.job.title, '社群销售');
  assert.equal(response.job.description, '负责社群运营、客户沟通和销售转化，完成业务目标并持续优化服务流程。');
});

test('BOSS extracts the standalone job_detail DOM without changing the search-panel path', () => {
  const header = node('', {
    '.info-primary .name h1': node('民宿B端商家AI产品经理'),
    '.info-primary .name .salary': node('30-50K·15薪'),
    '.info-primary .text-city': node('上海'),
    '.info-primary .text-experiece': node('3-5年'),
    '.info-primary .text-degree': node('本科')
  });
  const description = node('kanzhun岗位职责:\n1. 深入使用商家端产品，准确识别商家痛点并推动AI落地。', {
    span: [node('kanzhun')]
  });
  const document = node('', {
    '.job-banner .job-primary.detail-box': header,
    ".sider-company .company-info a[ka='job-detail-company_custompage']": node('美团'),
    '.job-keyword-list + .job-sec-text': description
  });
  const href = 'https://www.zhipin.com/job_detail/afeca8959519f3020nFy39y5GVBX.html?ka=hot-job-2';

  const response = extractWithDocument(document, href);

  assert.equal(response.ok, true);
  assert.deepEqual({ ...response.job }, {
    title: '民宿B端商家AI产品经理',
    company: '美团',
    companyIndustry: '',
    companyStage: '',
    companyScale: '',
    location: '上海',
    experience: '3-5年',
    education: '本科',
    salary: '30-50K·15薪',
    description: '岗位职责:\n1. 深入使用商家端产品，准确识别商家痛点并推动AI落地。',
    postedDate: '',
    sourceSite: 'boss直聘',
    sourceUrl: href
  });
});

test('BOSS standalone job_detail extracts company industry, stage and scale', () => {
  const header = node('', {
    '.info-primary .name h1': node('全栈开发工程师'),
    '.info-primary .name .salary': node('25-45K·16薪'),
    '.info-primary .text-city': node('上海'),
    '.info-primary .text-experiece': node('经验不限'),
    '.info-primary .text-degree': node('本科')
  });
  const document = node('', {
    '.job-banner .job-primary.detail-box': header,
    ".sider-company .company-info a[ka='job-detail-company_custompage']": node('浩鲸科技'),
    ".sider-company a[ka='job-detail-company_industry']": node('通信/网络设备'),
    ".sider-company a[ka='job-detail-company_stage']": node('未融资'),
    ".sider-company a[ka='job-detail-company_scale']": node('10000人以上'),
    '.job-keyword-list + .job-sec-text': node('负责Web端及全栈开发工作。')
  });
  const href = 'https://www.zhipin.com/job_detail/f69ba4af90dde0250nx42d6_FFpZ.html';
  const response = extractWithDocument(document, href);

  assert.equal(response.ok, true);
  assert.equal(response.job.company, '浩鲸科技');
  assert.equal(response.job.companyIndustry, '通信/网络设备');
  assert.equal(response.job.companyStage, '未融资');
  assert.equal(response.job.companyScale, '10000人以上');
});

test('BOSS classifies unlabeled sider-company facts by text', () => {
  const header = node('', {
    '.info-primary .name h1': node('全栈开发工程师'),
    '.info-primary .name .salary': node('25-45K'),
    '.info-primary .text-city': node('上海'),
    '.info-primary .text-experiece': node('经验不限'),
    '.info-primary .text-degree': node('本科')
  });
  const document = node('', {
    '.job-banner .job-primary.detail-box': header,
    ".sider-company .company-info a[ka='job-detail-company_custompage']": node('叠纸游戏'),
    '.sider-company a': [
      node('叠纸游戏'),
      node('未融资'),
      node('10000人以上'),
      node('游戏'),
      node('查看全部职位')
    ],
    '.job-keyword-list + .job-sec-text': node('负责游戏客户端与服务端开发。')
  });
  const response = extractWithDocument(document, 'https://www.zhipin.com/job_detail/abc.html');

  assert.equal(response.ok, true);
  assert.equal(response.job.company, '叠纸游戏');
  assert.equal(response.job.companyStage, '未融资');
  assert.equal(response.job.companyScale, '10000人以上');
  assert.equal(response.job.companyIndustry, '游戏');
});

test('BOSS reads company scale and stage from sider-company text, not only links', () => {
  const header = node('', {
    '.info-primary .name h1': node('Agent开发（Java+大数据背景）'),
    '.info-primary .name .salary': node('18-23K'),
    '.info-primary .text-city': node('上海'),
    '.info-primary .text-experiece': node('3-5年'),
    '.info-primary .text-degree': node('大专')
  });
  const document = node('', {
    '.job-banner .job-primary.detail-box': header,
    ".sider-company .company-info a[ka='job-detail-company_custompage']": node('浩鲸科技'),
    '.sider-company a': [node('浩鲸科技'), node('查看全部职位')],
    '.sider-company p': [node('未融资'), node('10000人以上'), node('通信/网络设备')],
    '.sider-company': node('浩鲸科技\n未融资\n10000人以上\n通信/网络设备\n查看全部职位'),
    '.job-keyword-list + .job-sec-text': node('负责大模型的开发工作，包含模型搭建、训练及优化。')
  });
  const response = extractWithDocument(document, 'https://www.zhipin.com/job_detail/agent.html');

  assert.equal(response.ok, true);
  assert.equal(response.job.company, '浩鲸科技');
  assert.equal(response.job.companyIndustry, '通信/网络设备');
  assert.equal(response.job.companyStage, '未融资');
  assert.equal(response.job.companyScale, '10000人以上');
});

test('BOSS pulls company scale out of a glued company-info line', () => {
  const header = node('', {
    '.info-primary .name h1': node('Agent开发（Java+大数据背景）'),
    '.info-primary .name .salary': node('18-23K'),
    '.info-primary .text-city': node('上海'),
    '.info-primary .text-experiece': node('3-5年'),
    '.info-primary .text-degree': node('大专')
  });
  const document = node('', {
    '.job-banner .job-primary.detail-box': header,
    ".sider-company .company-info a[ka='job-detail-company_custompage']": node('浩鲸科技'),
    '.sider-company': node('未融资10000人以上通信/网络设备'),
    '.job-keyword-list + .job-sec-text': node('负责大模型的开发工作，包含模型搭建、训练及优化。')
  });
  const response = extractWithDocument(document, 'https://www.zhipin.com/job_detail/agent.html');

  assert.equal(response.ok, true);
  assert.equal(response.job.companyScale, '10000人以上');
  assert.equal(response.job.companyStage, '未融资');
  assert.equal(response.job.companyIndustry, '通信/网络设备');
});

test('Liepin extracts all core fields and normalizes the posted date', () => {
  const document = node('', {
    '.job-title.ellipsis-2': node('AI 产品经理'),
    '.salary': node('30-50k·15薪'),
    '.title-box': node('AI 产品经理'),
    '.company-info-container .company-card .content .name.ellipsis-1': node('示例科技有限公司'),
    '.job-properties span': [node('上海'), node('·'), node('3-5年'), node('·'), node('本科'), node('10月2日更新')],
    "[data-selector='job-intro-content']": node('负责 AI 产品规划和落地。')
  });

  const response = extractWithDocument(document, 'https://www.liepin.com/job/1962345005.shtml');
  assert.equal(response.ok, true);
  assert.equal(response.job.title, 'AI 产品经理');
  assert.equal(response.job.company, '示例科技有限公司');
  assert.equal(response.job.location, '上海');
  assert.equal(response.job.experience, '3-5年');
  assert.equal(response.job.education, '本科');
  assert.equal(response.job.salary, '30-50k·15薪');
  assert.equal(response.job.description, '负责 AI 产品规划和落地。');
  assert.match(response.job.postedDate, /^\d{4}-10-02$/);
});

test('Liepin labels recruiter/intermediary postings as headhunter direct recruitment', () => {
  const document = node('', {
    '.job-title.ellipsis-2': node('产品负责人'),
    '.salary': node('40-70K'),
    '.title-box': node('李女士 · 猎头顾问'),
    '.company-info-container .company-card .content .name.ellipsis-1': node('某大型互联网公司'),
    '.job-properties span': [node('北京'), node('·'), node('5-10年'), node('·'), node('本科')],
    "[data-selector='job-intro-content']": node('负责产品战略。')
  });

  const response = extractWithDocument(document, 'https://www.liepin.com/job/123.shtml');
  assert.equal(response.ok, true);
  assert.equal(response.job.company, '猎头直招');
});

test('supported-site landing/list/loading pages without a detail structure are rejected', () => {
  for (const href of [
    'https://www.zhipin.com/',
    'https://www.zhaopin.com/jobs?kw=产品经理',
    'https://www.liepin.com/'
  ]) {
    const response = extractWithDocument(node(), href);
    assert.equal(response.ok, false, href);
    assert.match(response.message, /不像岗位详情页/);
  }
});

test('partially loaded details are rejected until both title and description exist', () => {
  const bossDetail = node('', {
    '.job-detail-header .job-detail-info .job-name': node('产品经理')
  });
  const cases = [
    {
      href: 'https://www.zhipin.com/job_detail/loading.html',
      document: node('', { '.job-detail-container .job-detail-box': bossDetail })
    },
    {
      href: 'https://www.zhaopin.com/jobs?kw=产品经理',
      document: node('', { '.job-detail-summary__title-text': node('产品经理') })
    },
    {
      href: 'https://www.liepin.com/job/loading.shtml',
      document: node('', { '.job-title.ellipsis-2': node('产品经理') })
    }
  ];

  for (const fixture of cases) {
    const response = extractWithDocument(fixture.document, fixture.href);
    assert.equal(response.ok, false, fixture.href);
    assert.match(response.message, /未读取到完整岗位信息.*标题和岗位描述/);
    assert.equal(response.job.title, '产品经理');
    assert.equal(response.job.description, '');
  }
});

test('security verification, inactive jobs and expired login return actionable messages', () => {
  const cases = [
    {
      href: 'https://www.zhaopin.com/jobdetail/example.htm',
      pageText: 'Security Verification\n正在验证连接安全性，请勾选下方复选框。',
      message: /正在进行安全验证.*完成验证/
    },
    {
      href: 'https://www.liepin.com/job/example.shtml',
      pageText: '该职位已暂停招聘',
      message: /岗位已暂停或下线.*更换有效岗位/
    },
    {
      href: 'https://www.zhipin.com/job_detail/example.html',
      pageText: '登录状态已失效，请重新登录',
      message: /登录状态已失效.*重新登录/
    }
  ];

  for (const fixture of cases) {
    const document = node();
    document.title = fixture.pageText.split('\n')[0];
    document.body = node(fixture.pageText);
    const response = extractWithDocument(document, fixture.href);
    assert.equal(response.ok, false, fixture.href);
    assert.match(response.message, fixture.message);
  }
});

test('a normal page navigation login label does not hide a valid job', () => {
  const document = node('', {
    '.job-title.ellipsis-2': node('产品经理'),
    "[data-selector='job-intro-content']": node('负责产品规划和需求分析。')
  });
  document.body = node('首页 职位 登录/注册 产品经理 负责产品规划和需求分析。');
  const response = extractWithDocument(document, 'https://www.liepin.com/job/normal.shtml');

  assert.equal(response.ok, true);
});
