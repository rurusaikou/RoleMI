/**
 * AI Context 组装器。
 *
 * 按任务组装输入：Deep Analysis 使用 JD 原文；Match 使用岗位事实、岗位分析、
 * Job Profile 与 Resume Profile；Greeting 使用岗位理解与匹配证据。
 * Match 必须有有效的两侧 Profile，不回退完整 JD 或简历原文。
 * 常规 Context 超出预算直接报错；Deep Analysis 的重试单独构建压缩输入。
 */
import { normalizeTransferableMatch } from "./match-results.js";
import { MODEL_INPUT_LIMITS } from "../ai/token-limits.js";
import { reusableResumeProfile, taskDependencies } from "./cache.js";
import { getJobSummary } from "./summaries.js";
import { jobContent } from "./identity.js";

// 固定字段白名单：每次请求从本地资产重新组装，不附加其他岗位或模型对话历史。
export function buildTaskContext({ task, job, resume, tone = "natural", maxChars = 180 }) {
  const dependencies = taskDependencies(task, { job, resume, tone, maxChars });
  if (!dependencies) throw new Error("当前岗位、简历或匹配结果已失效，请重新分析。");
  let input;
  let modes;
  if (task === "deep_analysis") {
    input = jobContent(job);
    modes = { job: "raw", resume: "none" };
  } else if (task === "resume_match") {
    const jd = getJobSummary(job);
    const resumeProfile = reusableResumeProfile(resume);
    // Match 两侧都只消费已经完成的 Understanding 结果：Job Profile × Resume Profile。
    // Raw JD / Raw Resume 都不再作为正常 Match fallback，避免把理解职责重新塞给已关闭额外 reasoning 的 Match。
    if (!jd.analysis?.coreRequirements.length || !jd.analysis?.essence.length) {
      throw new Error("岗位深度分析尚未完成，请稍后重试。");
    }
    if (!resumeProfile) {
      throw new Error("简历理解尚未完成，请稍后重试。");
    }
    // 缓存身份和调用统计留在本地，模型只接收候选人事实。
    const { usage: _usage, resultId: _resultId, version: _version, promptVersion: _promptVersion, sourceVersion: _sourceVersion, updatedAt: _updatedAt, ...profileFacts } = resumeProfile;
    input = {
      job: jd.facts,
      jobSummary: jd.analysis,
      resumeProfile: profileFacts
    };
    modes = { job: "summary", resume: "profile" };
  } else if (task === "greeting") {
    const match = job.resumeMatch.result;
    const summary = getJobSummary(job);
    // Greeting 只消费最重要的 Match Evidence，不发送完整 Resume Profile，避免退化成简历摘要。
    const lengthConfig = ({
      100: { label: "精简", guidance: "只说最核心的信息", maxEvidence: 1 },
      180: { label: "标准", guidance: "核心身份 + 主要匹配点 + 沟通意愿", maxEvidence: 2 },
      260: { label: "详细", guidance: "提供更多岗位相关证据和动机", maxEvidence: 3 }
    })[Number(maxChars)] || { label: "标准", guidance: "核心身份 + 主要匹配点 + 沟通意愿", maxEvidence: 2 };
    const directMatches = (match.directMatches || [])
      .filter((item) => item.experience && item.proof)
      .map(({ requirement = "", experience, proof }) => ({ requirement, experience, proof }));
    const transferableMatches = (match.transferableMatches || []).map(normalizeTransferableMatch)
      .filter((item) => item.experience && item.transferability)
      .map(({ requirement = "", experience, transferability, boundary }) => ({
        requirement, experience, transferability, boundary: boundary || "不得表述为直接经验"
      }));
    const selectedDirect = directMatches.slice(0, lengthConfig.maxEvidence);
    const selectedTransferable = transferableMatches.slice(0, Math.max(0, lengthConfig.maxEvidence - selectedDirect.length));
    input = {
      jobSummary: {
        essence: summary.analysis.essence,
        coreRequirements: summary.analysis.coreRequirements
      },
      matchResult: { directMatches: selectedDirect, transferableMatches: selectedTransferable },
      toneLabel: ({ natural: "自然", concise_direct: "简洁直接", proactive: "积极主动", professional_formal: "专业正式" })[tone] || "自然",
      lengthConfig
    };
    modes = { job: "summary", resume: "match-evidence" };
  } else {
    throw new Error(`不支持的任务：${task}`);
  }
  // 预算计算序列化业务输入（含字段名），不包含后续添加的 Prompt 指令和输出 Schema。
  const inputChars = JSON.stringify(input).length;
  if (inputChars > MODEL_INPUT_LIMITS.contextChars) throw new Error("当前任务所需信息过长，请精简材料后重试；未截断输入。");
  return { task, dependencies, input, stats: { ...modes, inputChars } };
}

/**
 * Deep Analysis 的一次性 Retry Context。
 *
 * 第一次请求保留完整 JD；只有检测到输出截断 / JSON 不完整时才走这里。
 * Retry 不再调用额外模型做摘要，而是确定性压缩 JD：去重空白与重复段落，
 * 优先保留职责、要求、经验、技能、优先项等高信号段落，再按原顺序拼回。
 */
export function buildDeepAnalysisRetryContext(job) {
  const dependencies = taskDependencies("deep_analysis", { job });
  if (!dependencies) throw new Error("当前岗位已失效，请重新分析。");
  const raw = jobContent(job);
  const originalDescription = String(raw.description || "").trim();
  const description = compactJobDescription(
    originalDescription,
    MODEL_INPUT_LIMITS.deepAnalysisRetryDescriptionChars
  );
  const input = { ...raw, description };
  return {
    task: "deep_analysis",
    dependencies,
    input,
    stats: {
      job: "retry-compact",
      resume: "none",
      inputChars: JSON.stringify(input).length,
      originalDescriptionChars: originalDescription.length,
      compactDescriptionChars: description.length
    }
  };
}

function compactJobDescription(description, maxChars) {
  const normalized = String(description || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (normalized.length <= maxChars) return normalized;

  const blocks = normalized
    .split(/\n+/)
    .map((text, index) => ({ text: text.trim(), index }))
    .filter((item) => item.text)
    .filter((item, index, list) => list.findIndex((candidate) => candidate.text === item.text) === index);

  const highSignal = /职责|任职|要求|资格|经验|能力|技能|优先|加分|负责|工作内容|岗位|学历|专业|产品|业务|数据|AI|模型|算法|研发|协作|沟通|指标|增长|用户/i;
  const scored = blocks.map((block) => ({
    ...block,
    score: (block.index < 4 ? 3 : 0) + (highSignal.test(block.text) ? 5 : 0) + (block.text.length <= 220 ? 1 : 0)
  }));

  const selected = [];
  let used = 0;
  for (const block of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    const remaining = maxChars - used - (selected.length ? 1 : 0);
    if (remaining <= 0) break;
    const text = block.text.length <= remaining ? block.text : block.text.slice(0, remaining);
    if (!text) continue;
    selected.push({ ...block, text });
    used += text.length + (selected.length > 1 ? 1 : 0);
  }

  return selected.sort((a, b) => a.index - b.index).map((item) => item.text).join("\n").slice(0, maxChars);
}
