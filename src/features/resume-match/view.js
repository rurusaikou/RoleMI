/**
 * 匹配与修改建议视图：展示任务状态、证据详情、建议类别及等待和重试入口。
 * 渲染时转义业务文本，保持两项任务的成功与失败状态独立。
 */
import { resumeBlockingMessage } from "../../shared/context/cache.js";
import { escapeHtml, qs } from "../../shared/ui/dom.js";

const matchListRenderKeys = new WeakMap();

export function renderResumeMatchView(state) {
  const invalidResume = Boolean(resumeBlockingMessage(state.resumeState.data));
  const uploadError = state.resumeState.uploadError || "";
  const match = state.tasks.resumeMatch;
  const revision = state.tasks.resumeRevision;
  const result = match.result;
  const deepAnalysis = state.tasks.deepAnalysis;
  const resumeUploaded = state.resumeState.uploaded;
  const resumeParsing = state.resumeState.parsing;
  const resumeUnderstanding = state.resumeState.understanding;
  const preparingJob = deepAnalysis.status === "loading" && match.status !== "success";
  const preparingResume = resumeUnderstanding && match.status !== "success";
  const preparingMatch = preparingJob || preparingResume;
  // 状态展示按“输入不可用 → 前置准备 → Match → 已有结果”排序。
  // 即使重跑期间仍保留旧结果，也不能让准备态覆盖用户已经可读的结果。
  qs("#matchLoadingProgress").classList.toggle("is-hidden", invalidResume || !(preparingMatch || match.status === "loading"));
  qs("#analyzeResumeMatchBtn").disabled = invalidResume || preparingMatch || match.status === "loading" || !resumeUploaded || Boolean(resumeParsing);
  qs("#analyzeResumeMatchBtn").textContent = preparingJob && preparingResume
    ? "正在准备匹配"
    : preparingJob
      ? "正在理解岗位"
      : preparingResume
        ? "正在理解简历"
        : analyzeButtonText(match, revision);

  qs("#toRevisionBtn").disabled = invalidResume || match.status !== "success";
  qs("#toGreetingBtn").disabled = invalidResume || match.status !== "success";
  if (uploadError && resumeUploaded) {
    setMatchDetailsVisible(false);
    renderShell("上传失败", uploadError);
    clearMatchDetails();
    return;
  }
  if (invalidResume) {
    setMatchDetailsVisible(false);
    renderShell("无法匹配", resumeBlockingMessage(state.resumeState.data));
    clearMatchDetails();
    return;
  }
  if (state.resumeState.profileError && !result && !preparingMatch) {
    setMatchDetailsVisible(false);
    renderShell("简历理解失败", state.resumeState.profileError);
    clearMatchDetails();
    return;
  }

  if (preparingMatch && !result) {
    const message = preparingJob && preparingResume
      ? "正在理解岗位要求和简历内容，请稍候…"
      : preparingJob
        ? "正在进行岗位深度分析，请稍候…"
        : "正在理解简历内容，请稍候…";
    setMatchDetailsVisible(false);
    renderShell("准备匹配", message);
    clearMatchDetails();
    return;
  }

  if (match.status === "loading" && !result) {
    setMatchDetailsVisible(false);
    renderShell("分析中", "正在结合岗位要求与简历经历进行匹配...");
    clearMatchDetails();
    return;
  }

  if (match.status === "error" && !result) {
    setMatchDetailsVisible(false);
    renderShell("分析失败", match.error);
    clearMatchDetails();
    return;
  }

  // 重新分析失败时 result 仍可能存在；继续渲染旧结果，并由按钮状态提供重试入口。
  if (!result) {
    setMatchDetailsVisible(false);
    renderShell("等待分析", "简历已上传，点击右上角“开始分析”生成匹配结果。");
    clearMatchDetails();
    return;
  }

  setMatchDetailsVisible(true);
  renderShell(result.level, result.reason || "已完成匹配分析。");
  qs("#matchMatchedCount").textContent = String(result.directMatches.length);
  qs("#matchPartialCount").textContent = String(result.transferableMatches.length);
  qs("#matchMissingCount").textContent = String(result.gaps.length);
  renderMatchList(result);
  const revisions = result.revisions || [];
  const priorityText = revision.status === "loading" || revision.status === "error"
    ? ""
    : revisionPriorityText(revisions);
  qs("#revisionPriorityText").textContent = priorityText;
  qs("#revisionPriority").classList.toggle("is-hidden", !priorityText);
  const list = qs("#suggestList");
  if (revision.status === "loading") {
    // 保留等待节点，常规刷新不重置轮播动画。
    if (!list.querySelector(".revision-waiting")) list.innerHTML = revisionWaitingHtml();
  } else {
    list.innerHTML = revision.status === "error"
      ? `<div class="revision-error" role="alert"><span>重新生成修改意见</span><button id="retryRevisionBtn" class="revision-retry-btn" type="button" aria-label="重新生成修改意见" title="重新生成修改意见"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20 7v5h-5"></path><path d="M19.2 12a7.2 7.2 0 1 0-1.8 4.8M20 12l-2.5-3"></path></svg></button></div>`
      : revisions.length
        ? revisions.map(revisionHtml).join("")
        : `<p class="match-empty">${escapeHtml(result.revisionCompleted ? "暂无修改建议。" : "修改建议尚未生成。")}</p>`;
  }
}

/** 修改建议等旁路状态刷新时不重建匹配 DOM，避免打断正在阅读的展开项。 */
function renderMatchList(result) {
  const list = qs("#matchList");
  const renderKey = JSON.stringify([
    result.directMatches,
    result.transferableMatches,
    result.gaps
  ]);
  if (matchListRenderKeys.get(list) === renderKey) return;
  list.innerHTML = [
    directSectionHtml(result.directMatches),
    transferableSectionHtml(result.transferableMatches),
    gapSectionHtml(result.gaps)
  ].join("");
  matchListRenderKeys.set(list, renderKey);
}

function setMatchDetailsVisible(visible) {
  qs("#matchMetricGrid").classList.toggle("is-hidden", !visible);
  qs("#matchList").classList.toggle("is-hidden", !visible);
  qs("#resumeSuggestionsCard").classList.toggle("is-hidden", !visible);
  qs("#revisionPrompt").classList.toggle("is-hidden", visible);
}

function clearMatchDetails() {
  const matchList = qs("#matchList");
  matchList.innerHTML = "";
  matchListRenderKeys.delete(matchList);
  qs("#suggestList").innerHTML = "";
  qs("#revisionPriorityText").textContent = "";
  qs("#revisionPriority").classList.add("is-hidden");
}

function analyzeButtonText(match, revision) {
  if (match.status === "loading") return "分析中";
  if (revision.status === "loading") return "重新分析";
  if (match.status === "success" || match.status === "error") return "重新分析";
  return "开始分析";
}

function renderShell(level, reason) {
  qs("#matchScore").textContent = level;
  qs("#matchVerdict").textContent = reason;
  qs("#matchMatchedCount").textContent = "0";
  qs("#matchPartialCount").textContent = "0";
  qs("#matchMissingCount").textContent = "0";
}

function directSectionHtml(items) {
  return sectionHtml("直接匹配", items, "matched", (item) => matchRecordHtml(item.requirement || "对应岗位要求", `
      ${fieldHtml("现有经历", item.experience)}
      ${fieldHtml("证明点", item.proof)}
  `));
}

function transferableSectionHtml(items) {
  return sectionHtml("可迁移能力", items, "partial", (item) => matchRecordHtml(item.requirement || "岗位要求", `
      ${fieldHtml("现有经历", item.experience)}
      ${fieldHtml("可迁移能力", (item.transferability || item.ability))}
      ${fieldHtml("迁移边界", item.boundary)}
  `));
}

function gapSectionHtml(items) {
  return sectionHtml("关键缺口", items, "missing", (item) => matchRecordHtml(item.gap || "缺口", `
      ${fieldHtml("对投递的影响", item.impact)}
  `, "single"));
}

function sectionHtml(title, items, status, renderItem) {
  if (!items.length) {
    return `
      <section class="match-section ${status}">
        <header>
          <div class="match-section-title">
            <span class="match-section-dot"></span>
            <strong>${escapeHtml(title)}</strong>
            <em>${escapeHtml(sectionDescription(status))}</em>
          </div>
        </header>
        <p class="match-empty">无明显内容。</p>
      </section>
    `;
  }

  return `
    <section class="match-section ${status}">
      <header>
        <div class="match-section-title">
          <span class="match-section-dot"></span>
          <strong>${escapeHtml(title)}</strong>
          <em>${escapeHtml(sectionDescription(status))}</em>
        </div>
      </header>
      <div class="match-record-list">
        ${items.map(renderItem).join("")}
      </div>
    </section>
  `;
}

function matchRecordHtml(title, details, layout = "") {
  return `
    <details class="match-record">
      <summary>
        <span class="match-record-main">${escapeHtml(title)}</span>
        <span class="match-record-toggle">
          <span class="toggle-open">展开⌄</span>
          <span class="toggle-close">收起⌃</span>
        </span>
      </summary>
      <dl class="match-record-fields ${escapeHtml(layout)}">${details}</dl>
    </details>
  `;
}

function fieldHtml(label, value) {
  if (!value) return "";
  return `
    <div>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

export function revisionHtml(item, index) {
  if (typeof item === "string") {
    return `
      <article class="resume-revision">
        <span class="revision-index">${String(index + 1).padStart(2, "0")}</span>
        <p>${escapeHtml(item)}</p>
      </article>
    `;
  }
  const reason = (item.reason || item.direction || "").trim();
  const rewrite = (item.rewrite || "").trim();
  const supplementHint = "请补充与该岗位相关的真实经历、职责或成果后再改写。";
  const title = item.summary || reason || "简历修改建议";
  const bodyText = reason || rewrite || item.summary || supplementHint;
  const details = [
    item.original ? `<p><span>原内容</span>${escapeHtml(item.original)}</p>` : "",
    `<p><span>修改依据 / 待补充信息</span>${escapeHtml(reason || supplementHint)}</p>`,
    rewrite ? `<p><span>可改为</span>${escapeHtml(rewrite)}</p>` : ""
  ].filter(Boolean).join("");

  return `
    <details class="resume-revision">
      <summary>
        <span class="revision-index">${String(index + 1).padStart(2, "0")}</span>
        <span class="revision-summary-main">
          <span class="revision-title-row">
            <strong>${escapeHtml(title)}</strong>
            ${item.category ? `<span class="revision-category">${escapeHtml(item.category)}</span>` : ""}
          </span>
          ${bodyText ? `<em>${escapeHtml(bodyText)}</em>` : ""}
        </span>
        <span class="resume-revision-toggle">
          <span class="toggle-open">⌄</span>
          <span class="toggle-close">⌃</span>
        </span>
      </summary>
      <div class="resume-revision-body">${details}</div>
    </details>
  `;
}

function revisionPriorityText(items) {
  const titles = (items || [])
    .map((item) => typeof item === "string" ? item : item.summary || (item.reason || item.direction) || "")
    .map((text) => text.split(/[，,。；;]/)[0].trim())
    .filter(Boolean)
    .slice(0, 3);
  return titles.length ? `优先补强：${titles.join("、")}` : "";
}

function sectionDescription(status) {
  if (status === "matched") return "具备岗位所需的关键经验和能力";
  if (status === "partial") return "相关经验可迁移到该岗位";
  return "当前简历中缺乏的关键要求或证据";
}

export function revisionWaitingHtml() {
  const topics = ["岗位要求与经历的关联", "真实经历中的关键证据", "简历表达的具体性与清晰度", "修改建议的优先级与可执行性"];
  return `<div class="revision-waiting" role="status" aria-label="正在生成修改建议，完成后自动显示。">
    <div class="revision-waiting-title"><span class="revision-spinner" aria-hidden="true"></span><strong>正在生成修改建议</strong></div>
    <div class="revision-topics" aria-hidden="true"><span>分析主题</span><div class="revision-topic-carousel">${topics.map((topic, index) => `<span style="--topic-index:${index}">${topic}</span>`).join("")}</div></div>
    <p>匹配结论已可查看，修改建议生成后会自动显示。</p>
  </div>`;
}
