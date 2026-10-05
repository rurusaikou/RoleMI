/**
 * 岗位分析视图：渲染结果、非 JD 提示和等待主题，管理等待计时器。
 * 输出文本经过 HTML 转义；主题仅用于等待展示。
 */
import { normalizeHiddenRequirements } from "../../shared/context/hidden-requirements.js";
import { escapeHtml, qs, qsa } from "../../shared/ui/dom.js";
import { validateJobForAnalysis } from "./result.js";

const ANALYSIS_LOADING_MESSAGES = [
  "正在识别核心要求…",
  "正在区分必要条件与加分项…",
  "正在分析隐含要求…",
  "正在整理理想候选人画像…",
  "正在整理分析结果…"
];
const ANALYSIS_LOADING_MESSAGE_INTERVAL_MS = 3500;
let analysisLoadingTimer = null;
let analysisLoadingJobId = null;
let analysisLoadingMessageIndex = 0;

export function renderDeepAnalysis(job, analysisState) {
  const result = job && job.deepAnalysis ? job.deepAnalysis : null;
  const isLoading = analysisState.analyzingJob === job.id;
  const error = analysisState.analysisError && analysisState.analysisError.jobId === job.id
    ? analysisState.analysisError.message
    : "";
  const validation = validateJobForAnalysis(job);
  const canAnalyze = validation.ok && !isLoading;
  const shouldShowResult = Boolean(result) && result.isJobDescription !== false;

  qs("#retryAnalysisBtn").classList.toggle("is-hidden", !canAnalyze);
  qs("#retryAnalysisBtn").disabled = !canAnalyze;
  qs("#analysisStatusCard").classList.toggle("loading", isLoading);
  qsa(".analysis-result-card").forEach((card) => card.classList.toggle("is-hidden", !shouldShowResult));

  syncAnalysisLoadingMessages({ isLoading, jobId: job.id });
  renderAnalysisStatus({ isLoading, validation, error, result });
  renderAnalysisSections(result);
}

function syncAnalysisLoadingMessages({ isLoading, jobId }) {
  if (!isLoading) {
    stopAnalysisLoadingMessages();
    return;
  }

  if (analysisLoadingTimer && analysisLoadingJobId === jobId) return;

  stopAnalysisLoadingMessages();
  analysisLoadingJobId = jobId;
  analysisLoadingMessageIndex = 0;
  analysisLoadingTimer = setInterval(() => {
    analysisLoadingMessageIndex = Math.min(
      analysisLoadingMessageIndex + 1,
      ANALYSIS_LOADING_MESSAGES.length - 1
    );
    const statusText = qs("#analysisStatusText");
    if (statusText) statusText.textContent = ANALYSIS_LOADING_MESSAGES[analysisLoadingMessageIndex];

    if (analysisLoadingMessageIndex === ANALYSIS_LOADING_MESSAGES.length - 1) {
      clearInterval(analysisLoadingTimer);
      analysisLoadingTimer = null;
    }
  }, ANALYSIS_LOADING_MESSAGE_INTERVAL_MS);
}

function stopAnalysisLoadingMessages() {
  if (analysisLoadingTimer) clearInterval(analysisLoadingTimer);
  analysisLoadingTimer = null;
  analysisLoadingJobId = null;
  analysisLoadingMessageIndex = 0;
}

function renderAnalysisStatus({ isLoading, validation, error, result }) {
  if (isLoading) {
    qs("#analysisStatusTitle").textContent = "正在深度分析";
    qs("#analysisStatusText").textContent = ANALYSIS_LOADING_MESSAGES[analysisLoadingMessageIndex];
    return;
  }

  if (!validation.ok) {
    qs("#analysisStatusTitle").textContent = "无法分析";
    qs("#analysisStatusText").textContent = validation.message;
    qs("#retryAnalysisBtn").classList.add("is-hidden");
    return;
  }

  if (error) {
    qs("#analysisStatusTitle").textContent = "分析失败";
    qs("#analysisStatusText").textContent = `${error} 请点击“重新分析”再次尝试。`;
    return;
  }

  if (result?.isJobDescription === false) {
    qs("#analysisStatusTitle").textContent = "当前内容不是招聘岗位";
    qs("#analysisStatusText").textContent = `${result.nonJdReason || ""} 不进行匹配、修改建议生成和沟通。请更换为招聘岗位描述后重新分析。`;
    return;
  }

  if (result) {
    qs("#analysisStatusTitle").textContent = "深度分析结果";
    qs("#analysisStatusText").textContent = result.updatedAt ? `最近分析： ${formatTime(result.updatedAt)}` : "已完成分析。";
    return;
  }

  qs("#analysisStatusTitle").textContent = "尚未分析";
  qs("#analysisStatusText").textContent = "点击“重新分析”生成该岗位的结构化深度分析。";
}

function renderAnalysisSections(result) {
  const analysis = result || {
    essence: [],
    coreRequirements: [],
    hiddenRequirements: [],
    idealCandidate: []
  };

  qs("#analysisEssence").innerHTML = essenceHtml(analysis.essence);
  qs("#analysisAudience").innerHTML = coreRequirementHtml(analysis.coreRequirements);
  qs("#analysisHidden").innerHTML = hiddenRequirementHtml(analysis.hiddenRequirements);
  qs("#analysisIdeal").innerHTML = listHtml(analysis.idealCandidate);
}

function essenceHtml(items) {
  return (items && items.length ? items : ["暂无结果"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function coreRequirementHtml(items) {
  return (items && items.length ? items : ["暂无结果"]).map((item, index) => {
    const [title, description] = splitCoreRequirement(item);
    return `
      <li class="core-requirement">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <div>
          <strong>${escapeHtml(title)}</strong>
          ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        </div>
      </li>
    `;
  }).join("");
}

function listHtml(items) {
  return (items && items.length ? items : ["暂无结果"]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

export function hiddenRequirementHtml(items) {
  const rows = normalizeHiddenRequirements(items);
  if (!rows.length) return "<li>暂无有充分依据的隐形要求</li>";
  return rows.map(({ requirement, basis }) => `
    <li class="hidden-requirement">
      <span>${escapeHtml(requirement)}</span>
      ${basis ? `<small><strong>依据：</strong>${escapeHtml(basis.replace(/^依据[：:]\s*/, ""))}</small>` : ""}
    </li>
  `).join("");
}

function splitCoreRequirement(item) {
  const text = String(item || "").trim();
  const parts = text.split(/[：:｜|]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length > 1 && parts[0].length <= 18) return [parts[0], parts.slice(1).join("：")];
  const sentenceMatch = text.match(/^(.{2,18}?)(?:，|,|。|\s)(.+)$/);
  if (sentenceMatch) return [sentenceMatch[1].trim(), sentenceMatch[2].trim()];
  return [text, ""];
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
