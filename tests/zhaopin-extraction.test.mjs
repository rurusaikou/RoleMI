import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const contentScript = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');

function node(text = '', selectors = {}) {
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

function newZhaopinDetailRoot(title) {
  const tags = [
    node('北京·西城区·西便门', { span: node('北京·西城区·西便门') }),
    node('1-3年', { span: node('1-3年') }),
    node('本科', { span: node('本科') })
  ];
  return node('', {
    '.job-detail-summary__salary': node('2-2.3万·15薪'),
    '.job-detail-summary__title-text': node(title),
    '.job-detail-summary__company-name': node('北京跃瀚科技有限责任公司'),
    '.job-detail-summary__tags .job-detail-summary__tag': tags,
    '.job-description__content': node('负责产品规划、需求调研与 PRD 编写。')
  });
}

test('extracts the current job from Zhaopin search/recommend right detail panel', () => {
  const rightDetail = newZhaopinDetailRoot('系统产品经理（J10804）');
  const unrelatedList = node('', {
    '.job-detail-summary__title-text': node('左侧其他岗位')
  });
  const document = node('', {
    '.job-split-layout__right .job-detail-panel': rightDetail,
    '.job-detail-panel': unrelatedList
  });

  for (const href of [
    'https://www.zhaopin.com/jobs?jl=530&kw=产品经理',
    'https://www.zhaopin.com/beijing/ruanjianchanpinjingli/?pageMode=recommend&jl=530'
  ]) {
    const response = extractWithDocument(document, href);
    assert.equal(response.ok, true);
    assert.deepEqual({ ...response.job }, {
      title: '系统产品经理（J10804）',
      company: '北京跃瀚科技有限责任公司',
      location: '北京·西城区·西便门',
      experience: '1-3年',
      education: '本科',
      salary: '2-2.3万·15薪',
      description: '负责产品规划、需求调研与 PRD 编写。',
      postedDate: '',
      sourceSite: '智联招聘',
      sourceUrl: href
    });
  }
});

test('extracts Zhaopin category/direct-entry detail without split layout wrapper', () => {
  const detail = newZhaopinDetailRoot('兼聘PPT设计师');
  const document = node('', { '.job-detail-panel': detail });
  const response = extractWithDocument(document, 'https://www.zhaopin.com/beijing/pingmiansheji/');

  assert.equal(response.ok, true);
  assert.equal(response.job.title, '兼聘PPT设计师');
  assert.equal(response.job.description, '负责产品规划、需求调研与 PRD 编写。');
});

test('keeps the legacy Zhaopin detail selectors as fallback', () => {
  const legacy = node('', {
    '.summary-planes__salary': node('20-30K'),
    '.summary-planes__title span': node('产品经理'),
    '.company-summary__name-link': node('示例科技'),
    '.summary-planes__info li': [node('上海'), node('3-5年'), node('本科')],
    '.describtion-card__detail-content': node('负责产品需求分析。')
  });
  const response = extractWithDocument(legacy, 'https://jobs.zhaopin.com/123');

  assert.equal(response.ok, true);
  assert.equal(response.job.title, '产品经理');
  assert.equal(response.job.company, '示例科技');
  assert.equal(response.job.description, '负责产品需求分析。');
});
