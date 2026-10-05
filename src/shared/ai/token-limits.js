/**
 * AI 请求预算的统一配置：维护输入字符限制、输出 Token 和各任务推理强度。
 * 服务层读取这些值；调整后同步实现契约、流程文档及预算测试。
 */
// 输入限制按去除首尾空白后的 UTF-16 字符串长度计算，独立于输出 token 预算。
export const MODEL_INPUT_LIMITS = {
  jobDescriptionChars: 5000,
  resumeChars: 3000,
  // 简历提取文本上限；超限停止理解及下游分析，结果按 contentVersion 缓存。
  resumeProfileChars: 4000,
  // 固定任务上下文的总字符预算，包含结构化字段开销；常规请求超限拒绝，不偷偷截断。
  contextChars: 12000,
  // Deep Analysis 发生输出截断时，Retry 会使用确定性压缩后的 JD；不额外调用模型做摘要。
  deepAnalysisRetryDescriptionChars: 3200
};

// Deep Analysis 优先降低 reasoning 成本并压缩最终表达；只有检测到“输出未完整生成”时，
// 才允许一次稍高预算的 Compact Retry，避免把高预算变成默认成本。
export const MODEL_TOKEN_LIMITS = {
  deepAnalysis: {
    outputTokens: 4000,
    retryOutputTokens: 5000
  },
  resumeProfile: {
    outputTokens: 4000
  },
  resumeMatch: {
    outputTokens: 4000,
    retryOutputTokens: 6000,
    revisionOutputTokens: 7000,
    revisionRetryOutputTokens: 8000
  },
  greeting: {
    outputTokens: {
      min: 2500,
      perRequestedChar: 12
    }
  },
  settingsTest: {
    outputTokens: 40
  }
};

// 不同任务需要的推理深度不同：
// - Deep Analysis 首次与 Retry 当前均关闭额外 reasoning，以输出预算承载完整结构化结果；
// - Resume Profile 只做事实抽取与结构化，关闭额外 reasoning，减少纯抽取任务的延迟；
// - Match 只比较已结构化的 Job Profile 与 Resume Profile，关闭额外 reasoning，避免推理占满输出预算；
// - Revision 首次使用 low，降低对既有 Match 结论的机械依赖；Retry 关闭额外 reasoning，优先补齐结构化输出；
// - Greeting 使用 low，在事实边界内重新组织沟通表达。
// Provider 不支持 reasoning 参数时，由 API 适配层自动去参重试。
export const MODEL_REASONING_EFFORT = {
  deepAnalysis: "none",
  deepAnalysisRetry: "none",
  resumeProfile: "none",
  resumeMatch: "none",
  resumeMatchRetry: "none",
  resumeRevision: "low",
  resumeRevisionRetry: "none",
  greeting: "low"
};

export function greetingOutputTokens(maxChars) {
  const config = MODEL_TOKEN_LIMITS.greeting.outputTokens;
  const requestedChars = Number(maxChars);
  const dynamicTokens = Number.isFinite(requestedChars) ? requestedChars * config.perRequestedChar : 0;
  return Math.max(config.min, dynamicTokens);
}
