/**
 * AI 任务编排层。
 *
 * 标准流程：冻结输入 → 计算依赖 key → 创建 request ticket → 构建 Context →
 * 调用 Feature Service → 校验 ticket 仍有效 → 写回岗位结果。
 *
 * 这里不写 Prompt、不解析模型响应；这些职责属于对应 feature。
 */
import { startUsage, cachedUsage } from "../shared/backend/usage.js";
import { buildTaskContext } from "../shared/context/builders.js";
import { resumeBlockingMessage, isResultCurrent, resultMetadata, reusableAnalysis, reusableResumeProfile, taskKey } from "../shared/context/cache.js";
import { analyzeJobWithAi } from "../features/jd-analysis/service.js";
import { analyzeResumeMatchWithAi } from "../features/resume-match/service.js";
import { generateResumeRevisions } from "../features/resume-revision/service.js";
import { generateGreetingWithAi } from "../features/greeting/service.js";
import { buildResumeProfileWithAi } from "../features/resume/profile-service.js";
import { getResume, saveResumeProfile } from "../features/resume/storage.js";
import { getSettings } from "../features/settings/service.js";
import { deepAnalysisUserMessage, resumeProfileUserMessage } from "../shared/ai/errors.js";
import { requests, state, updateJobs } from "./runtime.js";

// 同一份 Resume contentVersion 的 Understanding 只允许一个在途请求。
// 上传后预计算与随后点击 Match 即使时间上重叠，也会复用同一个 Promise。
const resumeUnderstandingInFlight = new Map();

// 请求开始时复制输入，避免用户切换岗位/简历后正在执行的请求读取到新状态。
function frozenInputs(job, options = {}) {
  return {
    job: structuredClone(job),
    resume: state.resumeState.data ? structuredClone(state.resumeState.data) : null,
    ...options
  };
}

// 写回前再次校验 ticket 和 dependency key；失败即丢弃过期响应。
function stillValid(ticket, task, key, snapshot, jobs) {
  const liveJob = jobs.find((item) => item.id === snapshot.job.id);
  return Boolean(liveJob && requests.isCurrent(ticket) && key === taskKey(task, {
    job: liveJob,
    resume: state.resumeState.data,
    tone: snapshot.tone,
    maxChars: snapshot.maxChars
  }));
}

/** 执行单个岗位的 JD 深度分析。 */
export async function runDeepAnalysis(job, { onUpdate = () => {} } = {}) {
  const snapshot = frozenInputs(job);
  const key = taskKey("deep_analysis", snapshot);
  if (!key) return;
  // 页面切换后再次触发同一岗位，也复用当前请求，避免重复模型调用和计费。
  if (requests.get("deep_analysis", job.id, key)?.loading) return;
  const finishUsage = startUsage("deep_analysis");
  const ticket = requests.start("deep_analysis", job.id, key);
  onUpdate();
  try {
    const context = buildTaskContext({ task: "deep_analysis", ...snapshot });
    const settings = await getSettings();
    if (!stillValid(ticket, "deep_analysis", key, snapshot, state.jobs)) return;
    const result = await analyzeJobWithAi(snapshot.job, settings, context);
    const metadata = resultMetadata(context);
    await updateJobs((jobs) => {
      if (!stillValid(ticket, "deep_analysis", key, snapshot, jobs)) return jobs;
      requests.invalidate("resume_match", job.id);
      requests.invalidate("resume_revision", job.id);
      requests.invalidate("greeting", job.id);
      return jobs.map((item) => item.id === job.id
        ? { ...item, deepAnalysis: { ...result, ...metadata }, resumeMatch: null, greeting: null }
        : item);
    });
    if (!stillValid(ticket, "deep_analysis", key, snapshot, state.jobs)) return;
    finishUsage(true);
    requests.finish(ticket);
    return true;
  } catch (error) {
    // 技术错误只向 Debug 输出受限代码和原因，Provider 返回体不写日志。
    // 页面不直接暴露内部细节，避免让用户处理自己无法控制的参数。
    if (requests.isCurrent(ticket)) finishUsage(false);
    requests.finish(ticket, deepAnalysisUserMessage(error));
    return false;
  } finally {
    onUpdate();
  }
}


/**
 * 确保当前简历拥有与 contentVersion 对应的 Resume Profile。
 * Resume Understanding 只按简历版本执行一次；缓存有效时直接复用。
 */
export async function runResumeUnderstanding({ onUpdate = () => {} } = {}) {
  const live = state.resumeState.data;
  if (!live?.id || !live?.contentVersion) return false;
  if (resumeBlockingMessage(live)) return false;
  if (reusableResumeProfile(live)) { cachedUsage("resume_profile"); return true; }

  // State 可能因 UI 刷新时序暂时落后于 chrome.storage。发请求前先检查持久化缓存，
  // 有效则同步回运行时，避免“上传已生成一次，点击开始分析又生成一次”。
  const persisted = await getResume();
  if (persisted?.id === live.id && persisted.contentVersion === live.contentVersion && reusableResumeProfile(persisted)) {
    cachedUsage("resume_profile");
    state.resumeState.data = persisted;
    state.resumeState.profileError = null;
    onUpdate();
    return true;
  }

  const key = `${live.id}:${live.contentVersion}`;
  const existing = resumeUnderstandingInFlight.get(key);
  if (existing) return existing;

  const finishUsage = startUsage("resume_profile");
  const snapshot = structuredClone(live);
  const task = (async () => {
    state.resumeState.understanding = true;
    state.resumeState.profileError = null;
    onUpdate();
    try {
      const settings = await getSettings();
      const profileData = await buildResumeProfileWithAi({ resume: snapshot, settings });
      const current = state.resumeState.data;
      if (!current || current.id !== snapshot.id || current.contentVersion !== snapshot.contentVersion) return false;
      const saved = await saveResumeProfile(snapshot, profileData);
      if (!saved) return false;
      state.resumeState.data = saved;
      finishUsage(Boolean(reusableResumeProfile(saved)));
      return Boolean(reusableResumeProfile(saved));
    } catch (error) {
      const current = state.resumeState.data;
      if (!current || current.id !== snapshot.id || current.contentVersion !== snapshot.contentVersion) return false;
      if (error.reason === "invalid_resume") {
        const saved = await saveResumeProfile(snapshot, { validResume: false });
        if (saved && state.resumeState.data?.id === snapshot.id && state.resumeState.data?.contentVersion === snapshot.contentVersion) state.resumeState.data = saved;
      }
      finishUsage(false);
      state.resumeState.profileError = resumeProfileUserMessage(error);
      return false;
    } finally {
      const current = state.resumeState.data;
      if (!current || (current.id === snapshot.id && current.contentVersion === snapshot.contentVersion)) {
        state.resumeState.understanding = false;
      }
      onUpdate();
    }
  })();

  resumeUnderstandingInFlight.set(key, task);
  try {
    return await task;
  } finally {
    if (resumeUnderstandingInFlight.get(key) === task) resumeUnderstandingInFlight.delete(key);
  }
}

/**
 * 执行简历流程：先 Match，成功后再启动独立 Revision。
 * Match 成功会立即持久化；Revision 即使失败也不会回滚 Match。
 */
export async function runResumePipeline(job, { onUpdate = () => {} } = {}) {
  // Match 需要两个 Understanding 结果：Job Profile 与 Resume Profile。
  // 缺哪个就自动补哪个；两者都缺时并行准备，减少串行等待。
  if (resumeBlockingMessage(state.resumeState.data)) return;
  let liveJob = state.jobs.find((item) => item.id === job.id) || job;
  if (reusableAnalysis(liveJob)?.isJobDescription === false) return;
  const needJobProfile = !reusableAnalysis(liveJob) || reusableAnalysis(liveJob).isJobDescription !== true;
  const needResumeProfile = !reusableResumeProfile(state.resumeState.data);
  if (!needJobProfile) cachedUsage("deep_analysis");
  if (!needResumeProfile) cachedUsage("resume_profile");
  const [jobReady, resumeReady] = await Promise.all([
    needJobProfile ? runDeepAnalysis(liveJob, { onUpdate }) : Promise.resolve(true),
    needResumeProfile ? runResumeUnderstanding({ onUpdate }) : Promise.resolve(true)
  ]);
  if (!jobReady || !resumeReady) return;

  liveJob = state.jobs.find((item) => item.id === job.id);
  if (!liveJob || reusableAnalysis(liveJob)?.isJobDescription !== true || !reusableResumeProfile(state.resumeState.data)) return;

  const snapshot = frozenInputs(liveJob);
  const matchKey = taskKey("resume_match", snapshot);
  if (!matchKey) return;
  requests.invalidate("resume_revision", job.id);
  requests.invalidate("greeting", job.id);
  const finishMatchUsage = startUsage("resume_match");
  const matchTicket = requests.start("resume_match", job.id, matchKey);
  onUpdate();

  let context;
  let settings;
  let matchResult;
  let metadata;
  try {
    context = buildTaskContext({ task: "resume_match", ...snapshot });
    settings = await getSettings();
    if (!stillValid(matchTicket, "resume_match", matchKey, snapshot, state.jobs)) return;
    matchResult = await analyzeResumeMatchWithAi({ ...snapshot, settings, context });
    metadata = resultMetadata(context);
    const stored = { ...metadata, result: { ...matchResult, revisions: [], revisionError: null, revisionCompleted: false } };
    await updateJobs((jobs) => {
      if (!stillValid(matchTicket, "resume_match", matchKey, snapshot, jobs)) return jobs;
      return jobs.map((item) => item.id === job.id ? { ...item, resumeMatch: stored, greeting: null } : item);
    });
    if (!stillValid(matchTicket, "resume_match", matchKey, snapshot, state.jobs)) return;
    finishMatchUsage(true);
    requests.finish(matchTicket);
    onUpdate();
  } catch (error) {
    if (requests.isCurrent(matchTicket)) finishMatchUsage(false);
    requests.finish(matchTicket, error.message || "匹配分析失败，请重试。");
    onUpdate();
    return;
  }

  await runResumeRevision(state.jobs.find((item) => item.id === job.id), { onUpdate });
}

/** 复用当前 Match，只重试修改建议，不重新调用匹配模型。 */
export async function runResumeRevision(job, { onUpdate = () => {} } = {}) {
  if (!job || resumeBlockingMessage(state.resumeState.data)) return;
  const snapshot = frozenInputs(job);
  if (!isResultCurrent("resume_match", job.resumeMatch, snapshot)) return;
  const metadata = job.resumeMatch;
  const matchResult = metadata.result;
  const matchKey = taskKey("resume_match", snapshot);
  if (requests.get("resume_match", job.id, matchKey)?.loading) return;
  const revisionKey = `${matchKey}:revision:${metadata.resultId}`;
  if (requests.get("resume_revision", job.id, revisionKey)?.loading) return;
  const finishRevisionUsage = startUsage("resume_revision");
  const revisionTicket = requests.start("resume_revision", job.id, revisionKey);
  onUpdate();
  try {
    const settings = await getSettings();
    const context = buildTaskContext({ task: "resume_match", ...snapshot });
    if (!stillValid(revisionTicket, "resume_match", matchKey, snapshot, state.jobs)) return;
    const revision = await generateResumeRevisions({ settings, resumeProfile: context.input.resumeProfile, matchResult, job: snapshot.job });
    await updateJobs((jobs) => {
      const live = jobs.find((item) => item.id === job.id);
      const current = live?.resumeMatch?.resultId === metadata.resultId && stillValid(revisionTicket, "resume_match", matchKey, snapshot, jobs);
      if (!current) return jobs;
      return jobs.map((item) => item.id === job.id ? {
        ...item,
        resumeMatch: {
          ...item.resumeMatch,
          result: { ...item.resumeMatch.result, ...revision, revisionCompleted: true, revisionError: null }
        }
      } : item);
    });
    if (!requests.isCurrent(revisionTicket)) return;
    finishRevisionUsage(true);
    requests.finish(revisionTicket);
  } catch (error) {
    if (requests.isCurrent(revisionTicket)) finishRevisionUsage(false);
    const message = error.message || "修改建议生成失败，请点击重试。";
    await updateJobs((jobs) => jobs.map((item) => item.id === job.id && item.resumeMatch?.resultId === metadata.resultId && stillValid(revisionTicket, "resume_match", matchKey, snapshot, jobs)
      ? { ...item, resumeMatch: { ...item.resumeMatch, result: { ...item.resumeMatch.result, revisionError: message, revisionCompleted: false } } }
      : item));
    requests.finish(revisionTicket, message);
  } finally {
    onUpdate();
  }
}

/** Match 已成功时执行开场白生成。Greeting 不依赖 Revision 是否成功。 */
export async function runGreeting(job, options, { onUpdate = () => {} } = {}) {
  const snapshot = frozenInputs(job, options);
  const key = taskKey("greeting", snapshot);
  if (!key) return;
  const finishUsage = startUsage("greeting");
  const ticket = requests.start("greeting", job.id, key);
  onUpdate();
  try {
    const context = buildTaskContext({ task: "greeting", ...snapshot });
    const settings = await getSettings();
    if (!stillValid(ticket, "greeting", key, snapshot, state.jobs)) return;
    const result = await generateGreetingWithAi({ ...snapshot, settings, context });
    const metadata = resultMetadata(context);
    await updateJobs((jobs) => {
      if (!stillValid(ticket, "greeting", key, snapshot, jobs)) return jobs;
      return jobs.map((item) => item.id === job.id ? { ...item, greeting: { ...metadata, ...options, result } } : item);
    });
    if (!stillValid(ticket, "greeting", key, snapshot, state.jobs)) return;
    finishUsage(true);
    requests.finish(ticket);
  } catch (error) {
    if (requests.isCurrent(ticket)) finishUsage(false);
    requests.finish(ticket, error.message || "开场白生成失败，请重试。");
  } finally {
    onUpdate();
  }
}
