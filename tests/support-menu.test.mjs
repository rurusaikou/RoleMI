import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("统一菜单提供设置、帮助和反馈入口", async () => {
  const [html, navigation] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/app/controllers/navigation-controller.js", root), "utf8")
  ]);
  for (const id of ["moreMenuBtn", "headerMenu", "settingsBtn", "helpBtn", "feedbackBtn", "helpView", "feedbackView"]) {
    assert.ok(html.includes(`id="${id}"`), `缺少 ${id}`);
  }
  assert.match(navigation, /openUtilityView\("help"\)/);
  assert.match(navigation, /openUtilityView\("feedback"\)/);
  assert.match(navigation, /state\.navigation\.view === view/);
  assert.match(navigation, /utilityReturnView = state\.navigation\.view/);
  assert.match(html, /id="helpBtn"[\s\S]*?class="menu-icon"/);
});

test("使用帮助按四组在原页独立抽拉并允许多项展开", async () => {
  const html = await readFile(new URL("src/popup.html", root), "utf8");
  for (const title of ["开始使用", "分析岗位", "准备投递", "管理岗位", "提取当前岗位", "手动添加岗位", "岗位分析", "简历匹配", "修改建议", "沟通草稿", "收藏", "导出收藏"]) {
    assert.ok(html.includes(title));
  }
  assert.ok(!html.includes('id="helpDetailView"'));
  assert.equal((html.match(/class="help-item"/g) || []).length, 8);
  assert.equal((html.match(/<details class="help-item">/g) || []).length, 8);
  assert.ok(!html.includes('name="help-accordion"'), "帮助条目不得通过同名 details 变成互斥手风琴");
});

test("反馈可提交关联岗位工作流快照", async () => {
  const [html, controller, css] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/app/controllers/feedback-controller.js", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8")
  ]);
  assert.match(html, /id="feedbackContent"[^>]*maxlength="500"/);
  assert.match(html, /id="feedbackJob"[^>]*name="jobId"/);
  assert.match(html, /不关联岗位/);
  assert.match(html, /相关岗位（可选）<\/strong><small class="feedback-job-hint">[\s\S]*?<\/small><select id="feedbackJob"/);
  assert.match(html, /value="analysis_inaccurate"/);
  assert.ok(!html.includes("feedbackFile"));
  assert.ok(!html.includes("feedbackIncludeContext"));
  assert.ok(!html.includes("feedbackCancelBtn"));
  assert.match(controller, /backendUrl\("\/api\/feedback"\)/);
  assert.match(controller, /jd_content/);
  assert.match(controller, /deep_analysis_result/);
  assert.match(controller, /match_result/);
  assert.match(controller, /revision_result/);
  assert.match(controller, /greeting_result/);
  assert.match(controller, /state\.jobs\.map/);
  assert.match(controller, /感谢反馈，我们已收到。/);
  assert.match(controller, /job\?\.description/);
  assert.ok(!controller.includes("resumeState"));
  assert.match(controller, /deep_analysis_result: snapshot\.deepAnalysis/);
  assert.match(css, /\.feedback-types\s*\{[\s\S]*?grid-template-columns: repeat\(2/);
  assert.match(css, /\.feedback-content textarea\s*\{[\s\S]*?min-height: 96px/);
  assert.match(css, /\.feedback-job-hint\s*\{[\s\S]*?color: var\(--muted\)[\s\S]*?font-size: 12px/);
  assert.match(css, /\.feedback-submit\s*\{[\s\S]*?width: 100%/);
});

test("反馈快照按浏览器存储层级拆分 Match 与 Revision", async () => {
  const { feedbackWorkflowSnapshot } = await import("../src/app/controllers/feedback-controller.js");
  const job = {
    deepAnalysis: { resultId: "analysis-1", essence: ["岗位本质"] },
    resumeMatch: {
      resultId: "match-1",
      key: "dependency-key",
      result: {
        level: "高度匹配",
        reason: "证据充分",
        revisions: [{ summary: "突出成果" }],
        revisionError: "",
        revisionCompleted: true,
        revisionUsage: { totalTokens: 12 }
      }
    },
    greeting: { resultId: "greeting-1", result: { greeting: "您好" } }
  };

  assert.deepEqual(feedbackWorkflowSnapshot(job), {
    deepAnalysis: job.deepAnalysis,
    match: {
      resultId: "match-1",
      key: "dependency-key",
      result: { level: "高度匹配", reason: "证据充分" }
    },
    revision: {
      revisions: [{ summary: "突出成果" }],
      revisionError: null,
      revisionCompleted: true,
      revisionUsage: { totalTokens: 12 }
    },
    greeting: job.greeting
  });
});

test("岗位分析状态卡在不同宽度保持指定对齐", async () => {
  const css = await readFile(new URL("src/popup.css", root), "utf8");
  assert.match(css, /#analysisStatusCard\s*\{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /\.analysis-state \.soft-btn\s*\{[\s\S]*?justify-self: end/);
  assert.match(css, /#analysisStatusCard\.loading > div\s*\{[\s\S]*?align-self: stretch;[\s\S]*?width: 100%/);
  assert.match(css, /#analysisStatusCard\.loading h2\s*\{[\s\S]*?justify-content: flex-start/);
  assert.match(css, /#analysisStatusCard > div\s*\{[\s\S]*?text-align: left/);
  assert.match(css, /#analysisStatusCard h2\s*\{[\s\S]*?text-align: left/);
  assert.match(css, /#analysisStatusCard p\s*\{[\s\S]*?text-align: left/);
});
