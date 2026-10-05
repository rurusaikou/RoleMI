/**
 * 岗位持久化与迁移：规范化历史数据、计算内容版本并处理岗位去重。
 * 经存储适配层读写，页面并发写入由 App Runtime 串行编排。
 */
import { normalizeTransferableMatch, normalizeRevision } from "../../shared/context/match-results.js";
import { STORAGE_KEY } from "../../shared/config/constants.js";
import { normalizeStoredDeepAnalysis } from "../jd-analysis/result.js";
import { getLocal, setLocal } from "../../shared/storage/chrome-storage.js";
import { contentVersion, jobContent, newId } from "../../shared/context/identity.js";
import { buildJobSummary } from "../../shared/context/summaries.js";
import { storedMetadata } from "../../shared/context/cache.js";

export async function getJobs() {
  const data = await getLocal({ [STORAGE_KEY]: [] });
  // 首次加载将旧岗位补齐身份和摘要并落盘，刷新后不会重新分配 ID。
  return setJobs(data[STORAGE_KEY] || []);
}

export async function setJobs(jobs) {
  const nextJobs = await Promise.all(dedupeJobs(jobs.map(normalizeJobForUi)).map(async (job) => {
    // 先更新内容版本，再构建摘要，确保旧版本的岗位分析不会被拼入新摘要。
    job.contentVersion = await contentVersion(jobContent(job));
    job.summary = buildJobSummary(job);
    return job;
  }));
  await setLocal({ [STORAGE_KEY]: nextJobs });
  return nextJobs;
}

export function appendUniqueJob(jobs, job) {
  const normalizedJobs = dedupeJobs(jobs.map(normalizeJobForUi));
  const normalizedJob = normalizeJobForUi(job);
  const nextJobs = dedupeJobs([...normalizedJobs, normalizedJob]);

  return {
    jobs: nextJobs,
    added: nextJobs.length > normalizedJobs.length
  };
}

// 首条记录优先：重复提取不覆盖已有收藏和 AI 结果，也不会刷新 JD 原文。
export function dedupeJobs(jobs) {
  const seen = new Set();
  const unique = [];

  for (const job of jobs) {
    const key = jobDedupeKey(job);
    if (!key) {
      unique.push(job);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(job);
  }

  return unique;
}

export function normalizeJobForUi(job) {
  return {
    id: job?.id || newId("job"),
    contentVersion: job?.contentVersion || "",
    summary: job?.summary || null,
    title: job && job.title ? job.title : "",
    company: job && job.company ? job.company : "",
    location: job && job.location ? job.location : "",
    experience: job && job.experience ? job.experience : "",
    education: job && job.education ? job.education : "",
    salary: job && job.salary ? job.salary : "",
    description: job && job.description ? job.description : "",
    postedDate: job && job.postedDate ? job.postedDate : "",
    sourceSite: job && job.sourceSite ? job.sourceSite : inferSourceSite(job && job.sourceUrl),
    sourceUrl: job && job.sourceUrl ? job.sourceUrl : "",
    starred: Boolean(job && job.starred),
    deepAnalysis: normalizeStoredDeepAnalysis(job && job.deepAnalysis),
    resumeMatch: normalizeStoredResumeMatch(job && job.resumeMatch),
    greeting: normalizeStoredGreeting(job && job.greeting)
  };
}

export function inferSourceSite(sourceUrl) {
  const url = String(sourceUrl || "");
  if (/zhipin\.com/i.test(url)) return "boss直聘";
  if (/zhaopin\.com/i.test(url)) return "智联招聘";
  if (/liepin\.com/i.test(url)) return "猎聘";
  return "";
}

function normalizeForDedupe(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// 手动录入用基本信息与正文去重；网页提取保留原有身份规则。
function jobDedupeKey(job) {
  const sourceUrl = normalizeForDedupe(job.sourceUrl);
  const identity = [
    normalizeForDedupe(job.title),
    normalizeForDedupe(job.company),
    normalizeForDedupe(job.location),
    normalizeForDedupe(job.salary)
  ].filter(Boolean).join("|");

  if (job.sourceSite === "手动添加" && !sourceUrl) {
    return JSON.stringify(["manual", identity, normalizeForDedupe(job.experience), normalizeForDedupe(job.description)]);
  }
  return sourceUrl ? `${sourceUrl}|${identity}` : identity;
}

function normalizeStoredResumeMatch(match) {
  if (!match || typeof match !== "object") return null;
  const result = match.result && typeof match.result === "object" ? match.result : match;
  return {
    ...storedMetadata(match),
    key: match.key || "",
    updatedAt: match.updatedAt || "",
    result: {
      level: result.level || "",
      reason: result.reason || "",
      directMatches: normalizeObjectList(result.directMatches),
      transferableMatches: normalizeObjectList(result.transferableMatches).map(normalizeTransferableMatch),
      gaps: normalizeObjectList(result.gaps),
      revisions: normalizeObjectList(result.revisions).map(normalizeRevision),
      revisionError: result.revisionError || "",
      revisionCompleted: Boolean(result.revisionCompleted),
      rawText: result.rawText || "",
      usage: normalizeTokenUsage(result.usage),
      revisionUsage: normalizeTokenUsage(result.revisionUsage)
    }
  };
}

function normalizeStoredGreeting(greeting) {
  if (!greeting || typeof greeting !== "object") return null;
  const result = greeting.result && typeof greeting.result === "object" ? greeting.result : greeting;
  return {
    ...storedMetadata(greeting),
    key: greeting.key || "",
    tone: greeting.tone || "",
    maxChars: Number(greeting.maxChars) || 0,
    updatedAt: greeting.updatedAt || "",
    result: {
      greeting: result.greeting || "",
      rawText: result.rawText || "",
      usage: normalizeTokenUsage(result.usage)
    }
  };
}

function normalizeObjectList(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = numberOrEmpty(usage.inputTokens);
  const outputTokens = numberOrEmpty(usage.outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokensOrFallback(usage.totalTokens, inputTokens, outputTokens)
  };
}

function numberOrEmpty(value) {
  if (value === "" || value === null || value === undefined) return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : "";
}

function totalTokensOrFallback(value, inputTokens, outputTokens) {
  const totalTokens = numberOrEmpty(value);
  if (totalTokens !== "") return totalTokens;
  if (inputTokens === "" || outputTokens === "") return "";
  return inputTokens + outputTokens;
}
