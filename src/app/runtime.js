/**
 * App 运行时。
 *
 * 统一持有 UI State、请求注册表和岗位写入队列，并把“持久化结果 + 当前请求状态”
 * 映射成页面使用的 Task State。这里是状态同步边界，不负责发起模型请求。
 */
import { isResultCurrent, taskKey } from "../shared/context/cache.js";
import { createRequestRegistry } from "../shared/context/requests.js";
import { normalizeJobForUi, setJobs } from "../features/jobs/repository.js";
import { createInitialState, TASK_STATUS } from "./state.js";

export const state = createInitialState();
export const requests = createRequestRegistry();
let jobsWriteQueue = Promise.resolve();

/** 返回当前选中的岗位；无岗位时给 UI 一个安全的空对象。 */
export function currentJob() {
  return state.jobs[state.navigation.selectedJob] || normalizeJobForUi({});
}

/**
 * 串行更新岗位列表。
 * 多个异步 AI 任务可能同时完成，写入队列可避免 storage 更新互相覆盖。
 */
export function updateJobs(update) {
  const operation = jobsWriteQueue.then(async () => {
    state.jobs = await setJobs(update(state.jobs));
    return state.jobs;
  });
  // 队列吞掉失败以便后续写入继续；返回原始 operation，让当前调用方仍能收到错误。
  jobsWriteQueue = operation.catch(() => {});
  return operation;
}

/** Revision 必须绑定 Match resultId，旧 Match 产生的建议因此无法覆盖新 Match。 */
export function revisionKey(job, matchResult) {
  const base = taskKey("resume_match", { job, resume: state.resumeState.data });
  return base && matchResult?.resultId ? `${base}:revision:${matchResult.resultId}` : "";
}

// 将 request ticket + 已保存结果归一化成 UI 四态。
function setStatusFromTicket(taskState, ticket, successResult, fallbackStatus = TASK_STATUS.IDLE) {
  if (ticket?.loading) {
    Object.assign(taskState, { status: TASK_STATUS.LOADING, error: null, result: successResult ?? taskState.result });
    return;
  }
  if (ticket?.error) {
    Object.assign(taskState, { status: TASK_STATUS.ERROR, error: ticket.error, result: successResult ?? taskState.result });
    return;
  }
  if (successResult !== null && successResult !== undefined) {
    Object.assign(taskState, { status: TASK_STATUS.SUCCESS, error: null, result: successResult });
    return;
  }
  Object.assign(taskState, { status: fallbackStatus, error: null, result: null });
}

/**
 * 根据“当前岗位、当前简历、持久化 AI 结果、当前 ticket”重建页面 Task State。
 * Controller 在 render 前调用它，从而不需要自己拼 loading/result/error 条件。
 */
export function syncTaskState() {
  const job = currentJob();
  const resume = state.resumeState.data;
  const matchKey = taskKey("resume_match", { job, resume });

  const analysis = requests.get("deep_analysis", job.id, taskKey("deep_analysis", { job }));
  const analysisResult = isResultCurrent("deep_analysis", job.deepAnalysis, { job }) ? job.deepAnalysis : null;
  setStatusFromTicket(state.tasks.deepAnalysis, analysis, analysisResult);
  state.tasks.deepAnalysis.loadingJobId = analysis?.loading ? job.id : null;

  const matchTicket = requests.get("resume_match", job.id, matchKey);
  const storedMatch = isResultCurrent("resume_match", job.resumeMatch, { job, resume }) ? job.resumeMatch : null;
  const matchResult = storedMatch?.result || null;
  state.tasks.resumeMatch.key = matchKey;
  setStatusFromTicket(state.tasks.resumeMatch, matchTicket, matchResult);

  const revKey = revisionKey(job, storedMatch);
  const revisionTicket = revKey ? requests.get("resume_revision", job.id, revKey) : null;
  state.tasks.resumeRevision.key = revKey;
  if (revisionTicket?.loading) {
    Object.assign(state.tasks.resumeRevision, { status: TASK_STATUS.LOADING, error: null, result: matchResult?.revisions || [] });
  } else if (revisionTicket?.error || matchResult?.revisionError) {
    Object.assign(state.tasks.resumeRevision, {
      status: TASK_STATUS.ERROR,
      error: revisionTicket?.error || matchResult.revisionError,
      result: matchResult?.revisions || []
    });
  } else if (matchResult?.revisionCompleted) {
    // 空建议列表也可能是成功结果，必须根据完成标记判断，不能用数组长度判断。
    Object.assign(state.tasks.resumeRevision, { status: TASK_STATUS.SUCCESS, error: null, result: matchResult.revisions || [] });
  } else {
    Object.assign(state.tasks.resumeRevision, { status: TASK_STATUS.IDLE, error: null, result: null });
  }

  // Greeting 的精确 tone/maxChars 由 greeting controller 刷新。
  if (!matchResult) Object.assign(state.tasks.greeting, { status: TASK_STATUS.IDLE, error: null, result: "" });
}

/** 简历变化后，所有依赖旧简历或旧 Match 的任务都必须失效。 */
export function resetResumeDependentTasks() {
  requests.invalidate("resume_match");
  requests.invalidate("resume_revision");
  requests.invalidate("greeting");
  Object.assign(state.tasks.resumeMatch, { status: TASK_STATUS.IDLE, error: null, result: null, key: "" });
  Object.assign(state.tasks.resumeRevision, { status: TASK_STATUS.IDLE, error: null, result: null, key: "" });
  Object.assign(state.tasks.greeting, { status: TASK_STATUS.IDLE, error: null, result: "" });
}
