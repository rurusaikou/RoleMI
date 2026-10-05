/**
 * 派生结果版本契约：定义上下文及 Prompt 版本，计算依赖键并判断缓存有效性。
 * 统一简历阻断规则，阻止旧输入或旧版本结果被下游任务复用。
 */
import { MODEL_INPUT_LIMITS } from "../ai/token-limits.js";
import { newId } from "./identity.js";

export const CONTEXT_VERSION = 1;
export const SUMMARY_VERSION = 3;
export const RESUME_PROFILE_VERSION = 2;
// Revision 随 Match 结果保存，未单独维护 Prompt 版本；修改 Revision Prompt 时需同步提升 resume_match 版本。
export const PROMPT_VERSIONS = { deep_analysis: 6, resume_profile: 3, resume_match: 9, greeting: 7 };

// 依赖用于判断缓存是否有效，不代表所有字段都会发送给模型；例如 Greeting 仍绑定完整岗位版本。
export function taskDependencies(task, { job, resume, tone, maxChars } = {}) {
  if (!job?.id || !job.contentVersion) return null;
  const dependencies = {
    task,
    contextVersion: CONTEXT_VERSION,
    promptVersion: PROMPT_VERSIONS[task],
    summaryVersion: SUMMARY_VERSION,
    jobId: job.id,
    jobVersion: job.contentVersion
  };
  if (task !== "deep_analysis") {
    if (!resume?.id || !resume.contentVersion) return null;
    // Resume Match 及其下游必须建立在当前 JD 的有效 Deep Analysis 上。
    // Deep Analysis 是数据依赖，不要求用户提前手动点击；Task Runner 会自动补齐。
    const analysis = reusableAnalysis(job);
    if (!analysis || analysis.isJobDescription !== true) return null;
    const profile = reusableResumeProfile(resume);
    if (!profile) return null;
    dependencies.resumeId = resume.id;
    dependencies.resumeVersion = resume.contentVersion;
    dependencies.resumeProfileId = profile.resultId;
    dependencies.resumeProfileVersion = profile.version;
    dependencies.analysisResultId = analysis.resultId;
  }
  if (task === "greeting") {
    if (!isResultCurrent("resume_match", job.resumeMatch, { job, resume })) return null;
    dependencies.matchResultId = job.resumeMatch.resultId;
    dependencies.tone = tone || "natural";
    dependencies.maxChars = Number(maxChars) || 180;
  }
  return dependencies;
}

export function dependencyKey(dependencies) {
  return dependencies ? JSON.stringify(dependencies) : "";
}

export function taskKey(task, inputs) {
  return dependencyKey(taskDependencies(task, inputs));
}

export function isResultCurrent(task, stored, inputs) {
  const key = taskKey(task, inputs);
  return Boolean(key && stored?.resultId && stored.key === key && dependencyKey(stored.dependencies) === key);
}

export function reusableAnalysis(job) {
  return isResultCurrent("deep_analysis", job?.deepAnalysis, { job }) ? job.deepAnalysis : null;
}

// 内容、Schema 和 Prompt 三个版本都一致才可复用；resultId 让下游识别同内容重新生成的 Profile。
export function resumeBlockingMessage(resume) {
  const length = String(resume?.rawText || "").trim().length;
  if (length > MODEL_INPUT_LIMITS.resumeProfileChars) return `当前文档共 ${length} 字，超过 ${MODEL_INPUT_LIMITS.resumeProfileChars} 字上限，不进入后续分析。请清除后上传精简版简历。`;
  return isInvalidResume(resume) ? "当前文档不是有效简历，请清除后上传简历。" : "";
}

export function isInvalidResume(resume) {
  const profile = resume?.profile;
  return profile?.validResume === false && profile.sourceVersion === resume.contentVersion;
}

export function reusableResumeProfile(resume) {
  if (resumeBlockingMessage(resume)) return null;
  const profile = resume?.profile;
  return profile?.resultId
    && profile.version === RESUME_PROFILE_VERSION
    && profile.sourceVersion === resume.contentVersion
    && profile.promptVersion === PROMPT_VERSIONS.resume_profile
    ? profile
    : null;
}

export function resultMetadata(context) {
  return {
    resultId: newId(context.task),
    key: dependencyKey(context.dependencies),
    dependencies: context.dependencies,
    contextStats: context.stats,
    updatedAt: new Date().toISOString()
  };
}

// 保留元数据供存储归一化使用；无元数据的历史结果不猜测版本、不自动复用。
export function storedMetadata(value) {
  return {
    resultId: value?.resultId || "",
    dependencies: value?.dependencies || null,
    contextStats: value?.contextStats || null,
    key: value?.key || ""
  };
}
