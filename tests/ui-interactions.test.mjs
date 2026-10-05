import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createExtractionSession, shouldReturnToJobs } from "../src/features/jobs/extraction-session.js";

const root = new URL("../", import.meta.url);

test("收藏导出、清空确认和异步按钮锁定保持一致", async () => {
  const [html, jobs, exporter, css] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/app/controllers/jobs-controller.js", root), "utf8"),
    readFile(new URL("src/features/jobs/export.js", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8")
  ]);
  assert.match(html, /id="exportFavoritesBtn"[^>]*>导出收藏<\/button>/);
  assert.match(html, /<dialog id="clearConfirmDialog"[\s\S]*?清空全部岗位？[\s\S]*?简历保留/);
  assert.match(jobs, /clearDialog\.showModal\(\)/);
  assert.match(jobs, /clearingJobs/);
  assert.match(jobs, /aria-busy/);
  assert.match(exporter, /button\.disabled = true/);
  assert.match(css, /button:not\(:disabled\):active/);
  assert.match(css, /button\[aria-busy="true"\]/);
  assert.match(css, /\.star-btn[\s\S]*?transition:/);
});

test("首页标签、返回文案和岗位分析状态保持一致", async () => {
  const [html, jobs, navigation, view] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/app/controllers/jobs-controller.js", root), "utf8"),
    readFile(new URL("src/app/controllers/navigation-controller.js", root), "utf8"),
    readFile(new URL("src/features/jobs/view.js", root), "utf8")
  ]);
  const backLabels = [...html.matchAll(/class="back-inline"[^>]*>([^<]+)<\/button>/g)].map((match) => match[1]);
  assert.ok(backLabels.length >= 4);
  assert.ok(backLabels.every((label) => label === "‹ 返回"));
  assert.match(navigation, /view !== "jobs" \|\| state\.jobs\.length > 0/);
  assert.match(jobs, /hasJobs && state\.navigation\.view === "jobs"/);
  for (const text of ["尚未分析", "已有分析结果", "分析岗位", "查看分析"]) assert.ok(view.includes(text));
  assert.match(view, /reusableAnalysis\(job\)/);
  assert.match(view, /export function favoriteCard[\s\S]*?const analyzed = Boolean\(reusableAnalysis\(job\)\)[\s\S]*?尚未分析[\s\S]*?分析岗位/);
  assert.ok(!view.includes("深度分析结果</button>"));
});

test("品牌入口进入独立欢迎首页且保留用户上下文", async () => {
  const [html, css, navigation, jobsController] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8"),
    readFile(new URL("src/app/controllers/navigation-controller.js", root), "utf8"),
    readFile(new URL("src/app/controllers/jobs-controller.js", root), "utf8")
  ]);

  assert.match(html, /id="homeBtn"[\s\S]*?aria-label="返回 RoleMI 首页"[\s\S]*?RoleMI/);
  assert.match(navigation, /#homeBtn[\s\S]*?setView\("home"\)[\s\S]*?#jobsView[\s\S]*?scrollTop = 0/);
  assert.match(navigation, /contentView = view === "home" \? "jobs" : view/);
  assert.match(navigation, /\.top-tabs button[\s\S]*?button\.dataset\.tab === view/);
  assert.match(css, /#jobsView\.is-home \.jobs-sticky-tools[\s\S]*?#jobsView\.is-home #jobList[\s\S]*?display: none/);
  assert.match(jobsController, /showingHome = state\.navigation\.view === "home"[\s\S]*?#emptyPanel[\s\S]*?hasJobs && !showingHome/);
  const homeHandler = navigation.match(/qs\("#homeBtn"\)[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.ok(!/search\s*=|jobs\s*=|requests/.test(homeHandler), "返回首页不应清空搜索、岗位或任务");
});

test("清空岗位池后重置欢迎首页的提取状态", async () => {
  const source = await readFile(new URL("../src/app/controllers/jobs-controller.js", import.meta.url), "utf8");

  assert.match(source, /const EMPTY_HOME_DEFAULT_STATUS = "支持 BOSS 直聘、智联招聘和猎聘"/);
  assert.match(source, /const message = result\.added[\s\S]*?setEmptyHomeStatus\(message\)/);
  assert.match(source, /await updateJobs\(\(\) => \[\]\)[\s\S]*?setEmptyHomeStatus\(\)/);
});

test("欢迎首页提取成功后返回岗位池", async () => {
  const source = await readFile(new URL("../src/app/controllers/jobs-controller.js", import.meta.url), "utf8");
  const extractionSuccess = source.match(/finishUsage\(true\);[\s\S]*?const message = result\.added/)?.[0] || "";

  assert.match(extractionSuccess, /shouldReturnToJobs\(startedFromHome, state\.navigation\.view\)/);
  assert.match(extractionSuccess, /actions\.setView\("jobs"\)/);
  assert.match(extractionSuccess, /actions\.refresh\(\)/);
  assert.match(source, /if \(result\.added\)[\s\S]*?scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("提取入口共享锁，清空使迟到结果失效且新岗位不受旧搜索影响", async () => {
  const source = await readFile(new URL("../src/app/controllers/jobs-controller.js", import.meta.url), "utf8");
  const extraction = source.match(/const extractCurrentJob = async \(\) => \{[\s\S]*?\n  \};/)?.[0] || "";
  const clearing = source.match(/#confirmClearBtn[\s\S]*?\n  \}\);/)?.[0] || "";

  assert.match(extraction, /const token = extractionSession\.begin\(\)[\s\S]*?if \(token === null\) return/);
  assert.match(extraction, /setExtractionBusy\(true\)/);
  assert.match(source, /buttons = \[qs\("#extractBtn"\), qs\("#emptyExtractBtn"\)\]/);
  assert.ok((extraction.match(/extractionSession\.isCurrent\(token\)/g) || []).length >= 3);
  assert.match(clearing, /invalidateExtraction\(\)[\s\S]*?await updateJobs\(\(\) => \[\]\)/);
  assert.match(extraction, /state\.navigation\.search = ""[\s\S]*?#jobSearch[\s\S]*?value = ""/);
});

test("提取事务按真实异步顺序隔离迟到结果和重复提交", async () => {
  const session = createExtractionSession();
  const first = session.begin();

  assert.equal(typeof first, "number");
  assert.equal(session.begin(), null, "在途提取期间必须拒绝第二次提交");
  session.invalidate();
  assert.equal(session.isCurrent(first), false, "清空后旧提取必须失效");

  const second = session.begin();
  assert.equal(session.isCurrent(second), true);
  assert.equal(session.finish(first), false, "迟到的旧请求不能结束或解锁新请求");
  assert.equal(session.begin(), null, "新请求仍在执行时必须保持互斥");
  assert.equal(session.finish(second), true);
  assert.equal(typeof session.begin(), "number", "当前请求完成后才允许再次提取");

  assert.equal(shouldReturnToJobs(true, "home"), true);
  for (const view of ["jobs", "favorites", "help", "settings"]) {
    assert.equal(shouldReturnToJobs(true, view), false, `用户已进入 ${view} 时不得抢夺导航`);
  }
  assert.equal(shouldReturnToJobs(false, "home"), false, "非首页发起的提取不得因中途进入首页而跳转");
});

test("收藏岗位底部入口按分析状态启动或查看分析", async () => {
  const controller = await readFile(new URL("src/app/controllers/jobs-controller.js", root), "utf8");
  assert.match(controller, /const analyzed = Boolean\(reusableAnalysis\(state\.jobs\[index\]\)\)/);
  assert.match(controller, /actions\.openJob\(index, "analysis", "favorites", \{ analyze: !analyzed \}\)/);
});

test("岗位池与收藏卡片本身均可打开岗位详情且操作按钮不冒泡", async () => {
  const [view, controller] = await Promise.all([
    readFile(new URL("src/features/jobs/view.js", root), "utf8"),
    readFile(new URL("src/app/controllers/jobs-controller.js", root), "utf8")
  ]);
  assert.match(view, /class="job-card[\s\S]*?<button class="job-card-detail-hit"[\s\S]*?aria-label="查看岗位详情/);
  assert.doesNotMatch(view, /class="job-card[^>]*role="link"/);
  assert.match(controller, /bindCardDetailEntry\(card, index, "favorites"\)/);
  assert.match(controller, /bindCardDetailEntry\(card, index, "jobs"\)/);
  assert.match(controller, /const openDetail = \(\) => actions\.openJob\(index, "jd", returnView\)/);
  assert.match(controller, /querySelector\('\[data-action="detail"\]'\)\.addEventListener\("click", openDetail\)/);
  assert.ok((controller.match(/event\.stopPropagation\(\)/g) || []).length >= 4);
});

test("高风险异步操作恢复按钮并提供失败反馈", async () => {
  const [jobs, settings] = await Promise.all([
    readFile(new URL("src/app/controllers/jobs-controller.js", root), "utf8"),
    readFile(new URL("src/app/controllers/settings-controller.js", root), "utf8")
  ]);
  assert.match(jobs, /catch \(error\)[\s\S]*?清空岗位失败，请重试[\s\S]*?finally[\s\S]*?button\.disabled = false/);
  assert.match(settings, /let settingsBusy = false/);
  assert.match(settings, /controls\.forEach[\s\S]*?disabled = busy/);
  assert.match(settings, /#testApiBtn[\s\S]*?#saveSettingsBtn[\s\S]*?#restoreDefaultServiceBtn/);
  assert.match(settings, /保存中…[\s\S]*?finally[\s\S]*?setBusy\(false\)/);
});

test("高中风险异步路径具备失败恢复、互斥和请求去重", async () => {
  const [jobs, settings, runner, controller, navigation, html, css] = await Promise.all([
    readFile(new URL("src/app/controllers/jobs-controller.js", root), "utf8"),
    readFile(new URL("src/features/settings/service.js", root), "utf8"),
    readFile(new URL("src/app/task-runner.js", root), "utf8"),
    readFile(new URL("src/app/controller.js", root), "utf8"),
    readFile(new URL("src/app/controllers/navigation-controller.js", root), "utf8"),
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8")
  ]);
  assert.match(jobs, /toggleStar[\s\S]*?catch \(_error\)[\s\S]*?收藏操作失败[\s\S]*?finally[\s\S]*?actions\.refresh\(\)/);
  assert.match(jobs, /clearDialog\.addEventListener\("cancel"[\s\S]*?event\.preventDefault\(\)/);
  assert.match(jobs, /cancelButton\.disabled = true[\s\S]*?cancelButton\.disabled = false/);
  assert.match(settings, /Promise\.allSettled[\s\S]*?previousApiKey[\s\S]*?previousPublicSettings/);
  assert.match(runner, /requests\.get\("deep_analysis", job\.id, key\)\?\.loading/);
  assert.ok((controller.match(/failures\.push/g) || []).length >= 3);
  assert.match(navigation, /ArrowDown[\s\S]*?ArrowUp[\s\S]*?Home[\s\S]*?End/);
  assert.match(navigation, /menuButton\.focus\(\)/);
  assert.match(html, /id="clearConfirmError"[^>]*role="alert"/);
  assert.match(css, /\.job-card-detail-hit\s*\{[\s\S]*?position: absolute/);
});

test("复制岗位描述按浏览器实际结果反馈且异常时安全失败", async () => {
  const [detail, dom] = await Promise.all([
    readFile(new URL("src/app/controllers/detail-controller.js", root), "utf8"),
    readFile(new URL("src/shared/ui/dom.js", root), "utf8")
  ]);
  assert.match(detail, /const copied = copyText[\s\S]*?copied \? "已复制" : "请手动复制"/);
  assert.match(dom, /return Boolean\(document\.execCommand\("copy"\)\)/);
  assert.match(dom, /catch \(_error\)[\s\S]*?return false;[\s\S]*?finally[\s\S]*?removeChild\(textarea\)/);
});

test("简历上传入口保留键盘可访问性并同步忙碌状态", async () => {
  const [html, css, controller] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8"),
    readFile(new URL("src/app/controllers/resume-controller.js", root), "utf8")
  ]);
  assert.match(html, /id="resumeUploadControl"[\s\S]*?aria-disabled="false"/);
  assert.match(css, /\.upload-btn input\s*\{[\s\S]*?position: absolute;[\s\S]*?clip-path: inset\(50%\)/);
  const uploadInputRule = css.match(/\.upload-btn input\s*\{([^}]*)\}/)?.[1] || "";
  assert.ok(!uploadInputRule.includes("display: none"));
  assert.match(css, /\.upload-btn:has\(input:focus-visible\)/);
  assert.match(controller, /#resumeUploadControl[\s\S]*?aria-disabled[\s\S]*?resumeBusy/);
});

test("岗位卡片分析入口使用清晰边框和独立点击热区", async () => {
  const [view, css] = await Promise.all([
    readFile(new URL("src/features/jobs/view.js", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8")
  ]);
  assert.equal((view.match(/class="soft-btn" data-action=/g) || []).length, 2);
  assert.match(css, /\.job-analysis-footer button\s*\{[\s\S]*?min-width: 88px;[\s\S]*?min-height: 32px;/);
});

test("岗位卡片星标固定在右上角并与标题行对齐", async () => {
  const css = await readFile(new URL("src/popup.css", root), "utf8");
  assert.match(css, /\.job-top\s*\{\s*align-items: flex-start;\s*\}/);
  assert.match(css, /\.job-top \.star-btn\s*\{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?margin-top: -6px;/);
});

test("按钮颜色按主次、文字与危险语义统一", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8")
  ]);
  assert.match(html, /id="confirmClearBtn" class="danger-primary"/);
  assert.match(css, /\.primary,\s*\.danger-primary\s*\{[\s\S]*?min-height: 36px/);
  assert.match(css, /\.danger-primary\s*\{[\s\S]*?background: var\(--danger\)/);
  assert.match(css, /\.danger-btn\s*\{[\s\S]*?border-color: #efc7c3/);
  assert.ok(!css.includes(".match-actions .danger-btn"));
});

test("简历匹配持续显示文件名、状态和更换入口", async () => {
  const [html, controller, workflow] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/app/controllers/resume-controller.js", root), "utf8"),
    readFile(new URL("src/features/resume/workflow.js", root), "utf8")
  ]);
  for (const id of ["resumeFileName", "resumeStatus", "resumeUploadLabel", "resumeFile"]) {
    assert.ok(html.includes(`id="${id}"`));
  }
  assert.match(html, /class="resume-file-head">[\s\S]*?class="resume-file-copy">[\s\S]*?id="resumeFileName"[\s\S]*?id="resumeStatus"[\s\S]*?id="resumeUploadLabel"/);
  assert.match(html, /class="upload-btn soft-btn compact-secondary"/);
  assert.match(html, /id="analyzeResumeMatchBtn" class="soft-btn compact-secondary"/);
  assert.ok(!/<article id="matchUploadPrompt"[\s\S]*?<h2>简历<\/h2>/.test(html));
  assert.match(controller, /matchUploadPrompt[\s\S]*?classList\.remove\("is-hidden"\)/);
  assert.match(controller, /uploaded \? "更换简历" : "上传简历"/);
  assert.match(controller, /source\?\.fileName/);
  assert.match(workflow, /resumeFileName[\s\S]*?file\.name/);
  assert.match(workflow, /if \(profile\)[\s\S]*?status\.classList\.add\("is-hidden"\)/);
});

test("界面使用蓝青紫轻量品牌色并弱化常规卡片阴影", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8")
  ]);
  assert.match(css, /--primary: #2468e8/);
  assert.match(css, /--cyan: #19b8d4/);
  assert.match(css, /--purple: #795ee8/);
  assert.match(css, /--shadow: none/);
  assert.match(css, /\.empty-hero\s*\{[\s\S]*?linear-gradient/);
  assert.match(css, /\.empty-hero\s*\{[\s\S]*?radial-gradient[\s\S]*?radial-gradient/);
  assert.match(html, /class="empty-brand-mark"[\s\S]*?logo-transparent-512\.png[\s\S]*?brand-node-blue[\s\S]*?brand-node-cyan[\s\S]*?brand-node-purple/);
  assert.match(css, /\.empty-brand-mark\s*\{[\s\S]*?width: 178px;[\s\S]*?height: 178px/);
  assert.match(css, /\.empty-brand-mark img\s*\{[\s\S]*?opacity: 0\.10/);
});

test("更换简历与重新分析使用同一紧凑按钮规格", async () => {
  const [html, css] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8")
  ]);
  assert.equal((html.match(/compact-secondary/g) || []).length, 2);
  assert.match(css, /\.compact-secondary\.compact-secondary\s*\{[\s\S]*?min-width: 78px;[\s\S]*?height: 30px;[\s\S]*?padding: 0 10px;/);
});
