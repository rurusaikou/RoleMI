/**
 * Responses 响应公共提取器：读取输出文本和 Token 用量，缺失用量保留为空。
 */
export function extractResponseContent(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  if (Array.isArray(payload.output)) {
    return payload.output.map(outputItemToText).filter(Boolean).join("\n").trim();
  }

  return "";
}

// 缺失用量保留为空；只有输入和输出都有效时才计算总数，避免导出虚假的 0。
export function extractTokenUsage(payload) {
  const usage = payload && payload.usage && typeof payload.usage === "object" ? payload.usage : null;
  if (!usage) return null;
  const inputTokens = numberOrEmpty(usage.input_tokens);
  const outputTokens = numberOrEmpty(usage.output_tokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens: totalTokensOrFallback(usage.total_tokens, inputTokens, outputTokens)
  };
}

function outputItemToText(item) {
  // Responses API 会同时返回 reasoning 和最终 message；页面只应该消费最终答案。
  if (!item || item.type !== "message") return "";
  return contentToText(item.content);
}

function contentToText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      if (item.type && item.type !== "output_text") return "";
      return contentToText(item.text || item.output_text || item.content);
    }).filter(Boolean).join("\n").trim();
  }
  if (content && typeof content === "object") {
    return contentToText(content.text || content.output_text);
  }
  return "";
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
