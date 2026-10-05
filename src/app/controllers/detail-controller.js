/**
 * 岗位详情与 JD 深度分析交互；模型调用交给 task-runner。
 * Controller 只连接 DOM、State 与业务动作，不包含 Prompt / Provider 细节。
 */
import { cachedUsage } from "../../shared/backend/usage.js";
import { reusableAnalysis } from "../../shared/context/cache.js";
import { copyText, flashButton, qs, qsa, setStatus } from "../../shared/ui/dom.js";
import { renderDeepAnalysis } from "../../features/jd-analysis/view.js";
import { validateJobForAnalysis } from "../../features/jd-analysis/result.js";
import { runDeepAnalysis } from "../task-runner.js";
import { currentJob, state, syncTaskState } from "../runtime.js";

let actions = { refresh: () => {}, setStep: () => {} };

export function configureDetailController(nextActions = {}) {
  actions = { ...actions, ...nextActions };
}

export function renderDetail() {
  if (!state.jobs.length) return;
  syncTaskState();
  const job = currentJob();
  const nonJd = reusableAnalysis(job)?.isJobDescription === false;
  qsa(".flow-tabs button").forEach((button) => {
    const blocked = nonJd && ["match", "revision", "greeting"].includes(button.dataset.step);
    button.disabled = blocked;
    button.title = blocked ? "当前内容不是招聘岗位，无法使用此功能" : "";
  });
  if (nonJd && ["match", "revision", "greeting"].includes(state.navigation.step)) actions.setStep("analysis");
  qs("#detailTitle").textContent = job.title || "未识别职位名";
  qs("#detailMeta").textContent = `${job.company || "公司待核对"} · ${metaLine(job)}`;
  qs("#jdFullTitle").textContent = job.title || "-";
  qs("#jdFullCompany").textContent = [job.company, job.location].filter(Boolean).join(" · ") || "-";
  qs("#jdFullMeta").textContent = [job.experience, job.education, job.postedDate, job.sourceSite].filter(Boolean).join(" · ") || "-";
  qs("#jdFullSalary").textContent = job.salary || "-";
  qs("#jdDetailText").textContent = job.description || "当前提取结果没有岗位描述，请核对招聘页面结构。";
  qs("#detailStar").classList.toggle("active", job.starred);
  renderDeepAnalysis({ ...job, deepAnalysis: reusableAnalysis(job) }, {
    analyzingJob: state.tasks.deepAnalysis.loadingJobId,
    analysisError: state.tasks.deepAnalysis.status === "error"
      ? { jobId: job.id, message: state.tasks.deepAnalysis.error }
      : null
  });
}

export async function startDeepAnalysis(index = state.navigation.selectedJob) {
  const job = state.jobs[index];
  if (!job) return;
  const validation = validateJobForAnalysis(job);
  if (!validation.ok) {
    setStatus(validation.message);
    return;
  }
  await runDeepAnalysis(job, { onUpdate: actions.refresh });
}

export function analyzeCurrentJobIfNeeded() {
  const job = currentJob();
  actions.setStep("analysis");
  if (!reusableAnalysis(job)) startDeepAnalysis();
  else cachedUsage("deep_analysis");
}

export function bindDetailEvents() {
  qs("#detailAnalyzeBtn").addEventListener("click", analyzeCurrentJobIfNeeded);
  qs("#retryAnalysisBtn").addEventListener("click", () => startDeepAnalysis());
  qs("#copyJdBtn").addEventListener("click", () => {
    const copied = copyText(qs("#jdDetailText").textContent.trim());
    flashButton(qs("#copyJdBtn"), copied ? "已复制" : "请手动复制");
  });
}

function metaLine(job) {
  return [job.location, job.salary, job.experience, job.education].filter(Boolean).join(" · ") || "岗位信息待核对";
}
