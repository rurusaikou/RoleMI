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
    ".job-card-box a.job-name[href*='/job_detail/']": [unrelatedLink, matchingLink]
  });

  const response = extractWithDocument(document, `https://www.zhipin.com/job_detail/${jobId}.html`);
  assert.equal(response.ok, true);
  assert.deepEqual({ ...response.job }, {
    title: '运动健康类 AI 产品经理',
    company: '安赋网络',
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
