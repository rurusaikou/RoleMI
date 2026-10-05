/**
 * AI 适配层使用的结构化错误。
 *
 * 提供错误分类、重试判定和用户提示映射；具体展示由任务及视图层处理。
 * 错误对象可携带诊断信息，Debug 日志只输出受限元数据，不直接打印 details。
 */
export class AiResponseIncompleteError extends Error {
  constructor(message, { reason = "unknown", details = null } = {}) {
    super(message);
    this.name = "AiResponseIncompleteError";
    this.code = "AI_RESPONSE_INCOMPLETE";
    this.reason = reason;
    this.details = details;
  }
}

export class AiOutputFormatError extends Error {
  constructor(message, { reason = "incomplete_json", details = null } = {}) {
    super(message);
    this.name = "AiOutputFormatError";
    this.code = "AI_OUTPUT_FORMAT";
    this.reason = reason;
    this.details = details;
  }
}

export class AiApiError extends Error {
  constructor(message, { status = 0, details = null } = {}) {
    super(message);
    this.name = "AiApiError";
    this.code = "AI_API_ERROR";
    this.status = status;
    this.details = details;
  }
}

export class AiNetworkError extends Error {
  constructor(message, { details = null } = {}) {
    super(message);
    this.name = "AiNetworkError";
    this.code = "AI_NETWORK_ERROR";
    this.details = details;
  }
}

/** Deep Analysis 只对“输出没完整生成”做一次业务重试。 */
export function isDeepAnalysisRetryableError(error) {
  if (!error) return false;
  if (error.code === "AI_RESPONSE_INCOMPLETE") return error.reason === "max_output_tokens";
  return error.code === "AI_OUTPUT_FORMAT" && ["incomplete_json", "empty_output"].includes(error.reason);
}


/** Resume Match 只对“最终结构化结果未完整生成”自动 Compact Retry 一次。 */
export function isResumeMatchRetryableError(error) {
  if (!error) return false;
  if (error.code === "AI_RESPONSE_INCOMPLETE") return error.reason === "max_output_tokens";
  return error.code === "AI_OUTPUT_FORMAT" && ["incomplete_json", "empty_output"].includes(error.reason);
}

/** 修改建议只对输出截断、JSON 不完整或空输出自动重试一次。 */
export function isResumeRevisionRetryableError(error) {
  if (!error) return false;
  if (error.code === "AI_RESPONSE_INCOMPLETE") return error.reason === "max_output_tokens";
  return error.code === "AI_OUTPUT_FORMAT" && ["incomplete_json", "empty_output"].includes(error.reason);
}

/**
 * 技术错误留给 Debug；页面只展示用户能处理的信息。
 * API 配置缺失本身已经是可行动提示，因此允许原样展示。
 */
export function deepAnalysisUserMessage(error) {
  if (error?.hosted) return error.message;
  const message = String(error?.message || "");
  if (/^请先在服务设置中/.test(message)) return message;
  if (error?.code === "AI_NETWORK_ERROR") return "连接模型服务失败，请检查网络或服务设置后重试。";
  if (error?.code === "AI_API_ERROR") return "模型服务暂时不可用，请检查服务设置后重试。";
  return "分析未完成，请重新分析。";
}


export function resumeProfileUserMessage(error) {
  if (error?.reason === "invalid_resume") return "当前文档不是有效简历，请清除后上传简历。";
  if (error?.hosted) return error.message;
  const message = String(error?.message || "");
  if (/^请先在服务设置中/.test(message)) return message;
  if (/超过 \d+ 字/.test(message)) return message;
  if (error?.code === "AI_NETWORK_ERROR") return "简历理解失败：请检查网络或服务设置后重试。";
  if (error?.code === "AI_API_ERROR") return "简历理解失败：模型服务暂时不可用，请稍后重试。";
  return "简历理解未完成，请点击“匹配”重试。";
}
