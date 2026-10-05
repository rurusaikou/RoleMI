/**
 * 反馈页面交互：从本地岗位池生成可选关联岗位，并向托管后端提交反馈。
 * 选择关联岗位时提交该岗位的 JD 与已生成工作流结果快照；不提交简历原文或附件。
 */
import { backendUrl } from "../../shared/backend/config.js";
import { getInstallationId } from "../../shared/backend/usage.js";
import { qs } from "../../shared/ui/dom.js";
import { state } from "../runtime.js";

const MAX_FEEDBACK_LENGTH = 500;
export function bindFeedbackEvents() {
  const content = qs("#feedbackContent");
  content.addEventListener("input", () => {
    qs("#feedbackCount").textContent = `${content.value.length} / ${MAX_FEEDBACK_LENGTH}`;
    qs("#feedbackSubmitBtn").disabled = !content.value.trim();
    setFeedbackStatus("");
  });
  qs("#feedbackForm").addEventListener("submit", submitFeedback);
}

export function renderFeedbackJobs() {
  const select = qs("#feedbackJob");
  const selected = select.value;
  const options = state.jobs.map((job) => {
    const option = document.createElement("option");
    option.value = job.id;
    option.textContent = `${job.title || "未命名岗位"}｜${job.company || "公司待核对"}`;
    return option;
  });
  select.replaceChildren(new Option("不关联岗位", ""), ...options);
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

export function feedbackWorkflowSnapshot(job) {
  if (!job) return {
    deepAnalysis: null,
    match: null,
    revision: null,
    greeting: null
  };

  const storedMatch = job.resumeMatch && typeof job.resumeMatch === "object" ? job.resumeMatch : null;
  const matchResult = storedMatch?.result && typeof storedMatch.result === "object" ? storedMatch.result : null;
  const {
    revisions,
    revisionError,
    revisionCompleted,
    revisionUsage,
    ...matchWithoutRevision
  } = matchResult || {};

  return {
    // 保持 chrome.storage 中的派生结果结构，连同依赖版本和 resultId 一起保存，便于复现 Bad Case。
    deepAnalysis: job.deepAnalysis || null,
    match: storedMatch ? { ...storedMatch, result: matchResult ? matchWithoutRevision : null } : null,
    revision: matchResult ? {
      revisions: Array.isArray(revisions) ? revisions : [],
      revisionError: revisionError || null,
      revisionCompleted: Boolean(revisionCompleted),
      revisionUsage: revisionUsage || null
    } : null,
    greeting: job.greeting || null
  };
}

async function submitFeedback(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const content = qs("#feedbackContent").value.trim();
  if (!content) return;

  const submitButton = qs("#feedbackSubmitBtn");
  submitButton.disabled = true;
  submitButton.textContent = "提交中…";
  setFeedbackStatus("");
  try {
    const data = new FormData(form);
    const jobId = String(data.get("jobId") || "");
    const job = jobId ? state.jobs.find((item) => item.id === jobId) : null;
    const snapshot = feedbackWorkflowSnapshot(job);
    const payload = {
      installation_id: await getInstallationId(),
      type: String(data.get("type") || ""),
      content,
      job_id: job?.id || null,
      job_title: job?.title || null,
      jd_content: job?.description || null,
      deep_analysis_result: snapshot.deepAnalysis,
      match_result: snapshot.match,
      revision_result: snapshot.revision,
      greeting_result: snapshot.greeting
    };
    const response = await fetch(backendUrl("/api/feedback"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error("反馈服务暂时不可用，请稍后重试。");
    form.reset();
    qs("#feedbackCount").textContent = `0 / ${MAX_FEEDBACK_LENGTH}`;
    setFeedbackStatus("感谢反馈，我们已收到。", "ok");
  } catch (error) {
    setFeedbackStatus(error.message || "提交失败，请稍后重试。", "error");
  } finally {
    submitButton.disabled = !qs("#feedbackContent").value.trim();
    submitButton.textContent = "提交反馈";
  }
}

function setFeedbackStatus(message, kind = "") {
  const status = qs("#feedbackStatus");
  status.textContent = message;
  status.className = `feedback-status${kind ? ` ${kind}` : ""}`;
}
