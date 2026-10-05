import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("岗位池空状态展示独立欢迎页并隐藏岗位管理工具", async () => {
  const [html, css, controller] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8"),
    readFile(new URL("src/app/controllers/jobs-controller.js", root), "utf8")
  ]);
  const emptyPanel = html.match(/<article id="emptyPanel"[\s\S]*?<\/article>/)?.[0] || "";
  for (const value of ["今天在看", "什么机会？", "先看懂岗位，再决定怎么投。", "看懂岗位", "看清差距", "知道怎么投"]) {
    assert.ok(emptyPanel.includes(value));
  }
  assert.match(emptyPanel, /class="empty-hero"/);
  assert.match(emptyPanel, /id="emptyExtractBtn" class="primary"/);
  assert.match(emptyPanel, /id="emptyManualAddBtn" class="empty-manual-btn"/);
  assert.match(emptyPanel, /支持 BOSS 直聘、智联招聘和猎聘/);
  assert.match(css, /#jobsView\.is-empty \.populated-home\s*\{[\s\S]*?display: none/);
  assert.match(css, /\.empty-value-list\s*\{[\s\S]*?grid-template-columns: repeat\(3, 1fr\)/);
  assert.match(html, /id="extractBtn" class="primary"[\s\S]*?提取当前岗位/);
  assert.match(html, /id="manualAddBtn" class="soft-btn"[\s\S]*?手动添加岗位/);
  assert.match(html, /id="searchRow"[\s\S]*?id="jobSearch"[\s\S]*?id="count" class="count"/);
  assert.match(html, /class="jobs-sticky-tools"[\s\S]*?id="extractBtn"[\s\S]*?id="searchRow"/);
  assert.match(css, /\.jobs-sticky-tools\s*\{[\s\S]*?position: sticky;[\s\S]*?top: 0;/);
  const stickyTools = css.match(/\.jobs-sticky-tools\s*\{[\s\S]*?\}/)?.[0] || "";
  assert.ok(!stickyTools.includes("box-shadow"), "岗位池吸顶区不应使用阴影");
  assert.match(css, /#jobsView #jobList\s*\{[\s\S]*?padding-top: 8px/);
  assert.match(css, /#jobsView\.is-empty \.jobs-sticky-tools\s*\{[\s\S]*?display: none/);
  const titleActions = html.match(/<div class="title-actions">[\s\S]*?<\/div>/)?.[0] || "";
  assert.ok(!titleActions.includes('id="count"'));
  assert.match(css, /\.search-row\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 38px/);
  assert.ok(!html.includes("JD"), "界面文案不应再混用 JD");
  for (const button of ["JD 结构化", "Excel 导出", "收藏归档", "沟通草稿"]) {
    assert.ok(!emptyPanel.includes(button));
  }
  assert.match(html, /id="bottomActions" class="bottom-actions is-hidden"/);
  assert.match(controller, /#jobsView[\s\S]*?classList\.toggle\("is-empty", !hasJobs\)/);
  assert.match(controller, /#emptyExtractBtn[\s\S]*?extractCurrentJob/);
  assert.match(controller, /#bottomActions[\s\S]*?classList\.toggle\("is-hidden", state\.jobs\.length === 0\)/);
});
