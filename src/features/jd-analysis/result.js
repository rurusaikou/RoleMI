/**
 * 岗位分析输入校验、结果规范化及历史缓存读取。
 * 区分非招聘内容与有效分析，保留要求依据和版本元数据。
 */
import { normalizeHiddenRequirements } from "../../shared/context/hidden-requirements.js";
import { MODEL_INPUT_LIMITS } from "../../shared/ai/token-limits.js";
import { storedMetadata } from "../../shared/context/cache.js";

export function validateJobForAnalysis(job) {
  const description = String(job && job.description || "").trim();
  const compact = description.replace(/\s+/g, "");

  if (!description) return { ok: false, message: "岗位描述为空，未发起分析。" };
  if (description.length > MODEL_INPUT_LIMITS.jobDescriptionChars) return { ok: false, message: "岗位描述超过 5000 字，未发起分析。" };
  if (compact.length < 20) return { ok: false, message: "岗位描述异常，未发起分析。" };
  if (/^(暂无|无|未识别|undefined|null|-)+$/i.test(compact)) return { ok: false, message: "岗位描述异常，未发起分析。" };

  return { ok: true, message: "" };
}

export function normalizeStoredDeepAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object") return null;
  return {
    ...storedMetadata(analysis),
    isJobDescription: typeof analysis.isJobDescription === "boolean" ? analysis.isJobDescription : null,
    nonJdReason: String(analysis.nonJdReason || "").trim(),
    essence: normalizeList(analysis.essence),
    coreRequirements: normalizeList(analysis.coreRequirements),
    hiddenRequirements: normalizeHiddenRequirements(analysis.hiddenRequirements),
    idealCandidate: normalizeList(analysis.idealCandidate),
    updatedAt: analysis.updatedAt || "",
    usage: normalizeTokenUsage(analysis.usage)
  };
}

export function normalizeAiAnalysis(data) {
  const result = normalizeStoredDeepAnalysis({
    isJobDescription: data.isJobDescription,
    nonJdReason: data.nonJdReason,
    essence: data.essence || data["岗位本质"],
    coreRequirements: data.coreRequirements || data["核心要求"],
    hiddenRequirements: data.hiddenRequirements || data["隐形要求"],
    idealCandidate: data.idealCandidate || data["理想候选人"],
    updatedAt: new Date().toISOString()
  });

  if (result.isJobDescription === false) {
    result.nonJdReason ||= "当前内容不是招聘岗位描述。";
    for (const field of ["essence", "coreRequirements", "hiddenRequirements", "idealCandidate"]) result[field] = [];
    return result;
  }

  // 隐形要求允许证据不足时为空；其余三个模块缺失会让页面无法成立。
  const hasRequiredContent = [
    result.essence,
    result.coreRequirements,
    result.idealCandidate
  ].every((list) => list.length > 0);

  if (!hasRequiredContent) throw new Error("分析失败：模型返回内容不完整。");
  return result;
}

function normalizeList(value) {
  const list = Array.isArray(value) ? value : [value].filter(Boolean);
  return list
    .map((item) => String(item || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 5);
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
