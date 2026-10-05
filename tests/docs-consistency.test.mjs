import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { CONTEXT_VERSION, PROMPT_VERSIONS, RESUME_PROFILE_VERSION, SUMMARY_VERSION } from "../src/shared/context/cache.js";
import { MODEL_INPUT_LIMITS, MODEL_REASONING_EFFORT, MODEL_TOKEN_LIMITS } from "../src/shared/ai/token-limits.js";

const root = new URL("../", import.meta.url);

async function sourceJavaScriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    if (entry.name === "vendor") return [];
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return sourceJavaScriptFiles(url);
    return entry.name.endsWith(".js") ? [url] : [];
  }));
  return nested.flat();
}

test("自有 JavaScript 源码在首个语句前保留模块说明", async () => {
  const files = await sourceJavaScriptFiles(new URL("src/", root));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.match(source, /^\s*\/\*\*[\s\S]*?\*\//, `${file.pathname} 缺少头部模块说明`);
  }
});

test("文档与 v3.0.0 Resume Understanding / Match Pipeline 保持一致", async () => {
  const [manifestText, readme, changelog, featureSpec, aiPipeline, architecture, dataModel, codeGuide, troubleshooting, popup, debugSource, xlsxSource] = await Promise.all([
    readFile(new URL("manifest.json", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("docs/CHANGELOG.md", root), "utf8"),
    readFile(new URL("docs/feature-spec.md", root), "utf8"),
    readFile(new URL("docs/ai-pipeline.md", root), "utf8"),
    readFile(new URL("docs/architecture.md", root), "utf8"),
    readFile(new URL("docs/data-model.md", root), "utf8"),
    readFile(new URL("docs/code-guide.md", root), "utf8"),
    readFile(new URL("docs/troubleshooting.md", root), "utf8"),
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/shared/ai/debug.js", root), "utf8"),
    readFile(new URL("src/xlsx.js", root), "utf8")
  ]);
  const manifest = JSON.parse(manifestText);
  const packageInfo = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  assert.equal(packageInfo.version, manifest.version);
  assert.equal(manifest.name, "RoleMI");
  assert.equal(manifest.action.default_title, "RoleMI");
  assert.equal(packageInfo.name, "rolemi");
  assert.match(readme, /^# RoleMI$/m);
  assert.match(popup, /<title>RoleMI<\/title>/);
  assert.match(popup, /id="homeBtn"[\s\S]*?>RoleMI<\/span><\/button>/);
  assert.match(debugSource, /window\.ROLEMI_DEBUG_API/);
  assert.match(xlsxSource, /window\.ROLEMI_XLSX/);

  assert.ok(!readme.includes("CHANGELOG"), "公开 README 不应引用未公开的版本记录");
  assert.ok(!readme.includes("docs/"), "公开 README 不应引用未公开的 docs 文档");
  assert.ok(changelog.includes(`## v${manifest.version}`));
  assert.ok(featureSpec.includes(`当前版本：v${manifest.version}`));
  assert.ok(featureSpec.includes(`CONTEXT_VERSION = ${CONTEXT_VERSION}`));
  assert.ok(featureSpec.includes(`SUMMARY_VERSION = ${SUMMARY_VERSION}`));
  assert.ok(featureSpec.includes(`RESUME_PROFILE_VERSION = ${RESUME_PROFILE_VERSION}`));
  assert.ok(featureSpec.includes(`JD 分析 ${PROMPT_VERSIONS.deep_analysis}`));
  assert.ok(featureSpec.includes(`Resume Profile ${PROMPT_VERSIONS.resume_profile}`));
  assert.ok(featureSpec.includes(`简历匹配 ${PROMPT_VERSIONS.resume_match}`));
  assert.ok(featureSpec.includes(`开场白 ${PROMPT_VERSIONS.greeting}`));
  assert.ok(featureSpec.includes(`当前版本：v${manifest.version}`));
  assert.match(featureSpec, /Greeting Prompt 7/);
  assert.match(featureSpec, /Match Prompt 9/);

  assert.ok(featureSpec.includes(`contextChars: ${MODEL_INPUT_LIMITS.contextChars}`));
  assert.ok(featureSpec.includes(`resumeProfileChars: ${MODEL_INPUT_LIMITS.resumeProfileChars}`));
  assert.ok(featureSpec.includes(`deepAnalysisRetryDescriptionChars: ${MODEL_INPUT_LIMITS.deepAnalysisRetryDescriptionChars}`));
  assert.ok(featureSpec.includes(`Deep Analysis 第一次预算为 \`${MODEL_TOKEN_LIMITS.deepAnalysis.outputTokens}\``));
  assert.ok(featureSpec.includes(`Retry 预算为 \`${MODEL_TOKEN_LIMITS.deepAnalysis.retryOutputTokens}\``));
  assert.ok(featureSpec.includes(`Resume Profile = \`${MODEL_TOKEN_LIMITS.resumeProfile.outputTokens}\``));
  assert.ok(featureSpec.includes(`Match 第一次 = \`${MODEL_TOKEN_LIMITS.resumeMatch.outputTokens}\`；Compact Retry = \`${MODEL_TOKEN_LIMITS.resumeMatch.retryOutputTokens}\``));
  assert.ok(featureSpec.includes(`Revision 首次 = \`${MODEL_TOKEN_LIMITS.resumeMatch.revisionOutputTokens}\`；Compact Retry = \`${MODEL_TOKEN_LIMITS.resumeMatch.revisionRetryOutputTokens}\``));

  for (const [label, effort] of [
    ["JD 深度分析", MODEL_REASONING_EFFORT.deepAnalysis],
    ["Resume Profile", MODEL_REASONING_EFFORT.resumeProfile],
    ["Resume Match", MODEL_REASONING_EFFORT.resumeMatch],
    ["Resume Revision", MODEL_REASONING_EFFORT.resumeRevision],
    ["Greeting", MODEL_REASONING_EFFORT.greeting]
  ]) {
    assert.match(featureSpec, new RegExp(`${label}[^\\n]*\`${effort}\``));
  }

  const docs = [readme, featureSpec, aiPipeline, architecture, dataModel, codeGuide, troubleshooting].join("\n");
  assert.match(docs, /Resume Understanding/);
  assert.match(docs, /Resume Profile/);
  assert.match(featureSpec, /Match 不回退 JD 原文，也不回退 Resume 原文/);
  assert.match(aiPipeline, /Match 不回退 Raw JD，也不回退 Raw Resume/);
  assert.match(architecture, /两者都缺失.*并行|并行准备/);
  assert.match(readme, /不会自动开始匹配/);
  assert.match(aiPipeline, /不会自动启动 Match/);
  assert.match(dataModel, /resumeProfileId/);
  assert.match(featureSpec, /优先直连用户的 Responses API/);
  assert.match(featureSpec, /Resume Profile 不保存姓名、手机号、邮箱/);
  assert.match(aiPipeline, /Resume Profile 不保存姓名、手机号、邮箱/);
  assert.match(troubleshooting, /rolemi\.resume\.profile\.projects/);

  // README 保持产品化，不暴露内部版本键细节。
  for (const implementationTerm of ["CONTEXT_VERSION", "RESUME_PROFILE_VERSION", "previous_response_id", "contextChars"]) {
    assert.ok(!readme.includes(implementationTerm));
  }
});

test("手动岗位录入上限与表单和文档保持一致且不显示计数", async () => {
  const { MANUAL_JD_MAX_LENGTH } = await import('../src/features/jobs/manual.js');
  const [html, controller, readme, spec, dataModel, product] = await Promise.all([
    'src/popup.html', 'src/app/controllers/jobs-controller.js', 'README.md',
    'docs/feature-spec.md', 'docs/data-model.md', 'docs/product.md'
  ].map((path) => readFile(new URL(path, root), 'utf8')));
  const textarea = html.match(/<textarea\b[^>]*id="manualDescription"[^>]*>/)?.[0];
  assert.ok(textarea);
  assert.ok(textarea.includes(`maxlength="${MANUAL_JD_MAX_LENGTH}"`));
  assert.match(textarea, /\brequired\b/);
  assert.ok(!html.includes('id="manualCount"'));
  assert.ok(!controller.includes("#manualCount"));
  assert.match(html, /岗位描述 <span>必填 · 最多 2000 字<\/span>/);
  assert.match(html, /<details id="manualOptionalDetails" class="manual-optional">[\s\S]*?<summary>补充信息 · 选填<\/summary>/);
  assert.match(html, /id="manualSubmitBtn"[^>]*disabled/);
  assert.match(html, /id="manualBackBtn"[^>]*>‹ 返回<\/button>/);
  assert.match(controller, /manualSubmitBtn[\s\S]*?disabled = saving \|\| !description\.value\.trim\(\)/);
  assert.ok(spec.includes(`MANUAL_JD_MAX_LENGTH = ${MANUAL_JD_MAX_LENGTH}`));
  for (const doc of [readme, spec, dataModel, product]) {
    assert.ok(doc.includes(String(MANUAL_JD_MAX_LENGTH)));
    assert.match(doc, /手动/);
  }
  assert.match(spec, /成功后.*返回岗位池/);
  assert.match(spec, /edge:\/\/extensions/);
  assert.match(spec, /不自动拆分/);
});


test("用户界面不暴露内部 Profile / Context 实现术语，Greeting 文档与长度策略一致", async () => {
  const [html, resumeWorkflow, matchView, readme, featureSpec, aiPipeline] = await Promise.all([
    "src/popup.html",
    "src/features/resume/workflow.js",
    "src/features/resume-match/view.js",
    "README.md",
    "docs/feature-spec.md",
    "docs/ai-pipeline.md"
  ].map((path) => readFile(new URL(path, root), "utf8")));

  const userFacing = [html, resumeWorkflow, matchView].join("\n");
  for (const implementationTerm of ["Job Profile", "Resume Profile", "Raw JD", "Raw Resume"]) {
    assert.ok(!userFacing.includes(implementationTerm), `用户界面不应暴露 ${implementationTerm}`);
  }
  const readmeUserGuide = readme.split("## 目录结构")[0];
  for (const implementationTerm of ["Job Profile", "Resume Profile", "Raw JD", "Raw Resume", "Revision", "Greeting"]) {
    assert.ok(!readmeUserGuide.includes(implementationTerm), `README 用户说明不应暴露 ${implementationTerm}`);
  }

  for (const copy of [
    "从岗位要求出发，识别你的匹配优势、可迁移能力与关键缺口。",
    "基于已有真实经历优化表达，提升简历与目标岗位的相关性。",
    "结合岗位重点与个人优势，生成更有针对性的求职开场白。"
  ]) {
    assert.ok(html.includes(copy));
  }

  for (const doc of [featureSpec, aiPipeline]) {
    assert.match(doc, /内容密度|精简.*标准.*详细/);
    assert.match(doc, /1 \/ 2 \/ 3|最多 1 条.*最多 2 条.*最多 3 条/);
    assert.match(doc, /不做字符截断|完整展示/);
  }

  assert.ok(!html.includes('greetingCounter'));
});


test("Deep Analysis 等待态文案与文档保持一致", async () => {
  const [view, html, readme, featureSpec] = await Promise.all([
    "src/features/jd-analysis/view.js",
    "src/popup.html",
    "README.md",
    "docs/feature-spec.md"
  ].map((path) => readFile(new URL(path, root), "utf8")));

  const messages = [
    "正在识别核心要求…",
    "正在区分必要条件与加分项…",
    "正在分析隐含要求…",
    "正在整理理想候选人画像…",
    "正在整理分析结果…"
  ];
  for (const message of messages) {
    assert.ok(view.includes(message));
    assert.ok(featureSpec.includes(message));
  }
  assert.match(view, /ANALYSIS_LOADING_MESSAGE_INTERVAL_MS = 3500/);
  assert.match(featureSpec, /每 3\.5 秒/);
  assert.match(html, /id="analysisStatusText" aria-live="polite"/);
  // README 只保留产品价值；等待主题等界面细节由实现契约负责精确描述。
  assert.match(readme, /先看懂岗位，再决定怎么投/);
  assert.match(featureSpec, /不代表模型真实执行阶段或完成比例/);
});
