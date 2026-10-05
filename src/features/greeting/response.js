/**
 * 开场白响应解析：提取生成文本、识别错误与推理泄漏，规范化展示结果。
 */
import { extractResponseContent } from "../../shared/ai/response.js";

const FORMAT_ERROR = "生成失败：模型返回格式异常。请点击“重新生成”再次尝试。";
const REASONING_LEAK_ERROR = "生成失败：模型返回了推理过程而不是开场白。请降低推理强度，或重新生成。";

export function parseGreetingResponse(payload) {
  const apiError = extractApiErrorMessage(payload);
  if (apiError) throw new Error(`生成失败：${apiError}`);

  const content = extractResponseContent(payload);
  if (!content) throw new Error("生成失败：模型返回为空。");
  const greeting = parseGreetingContent(content);
  if (!greeting) throw new Error(FORMAT_ERROR);
  return {
    greeting,
    rawText: content
  };
}

function parseGreetingContent(content) {
  try {
    const data = parseJsonContent(content);
    return cleanText(data.greeting || data["开场白"] || data.text || data["内容"]);
  } catch (_error) {
    const text = cleanText(content);
    if (!text) return "";
    if (looksLikeReasoningLeak(text)) throw new Error(REASONING_LEAK_ERROR);
    return text;
  }
}

function extractApiErrorMessage(payload) {
  const error = payload && payload.error;
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error.message === "string") return error.message;
  if (typeof error.error === "string") return error.error;
  return "";
}

function parseJsonContent(content) {
  const trimmed = stripJsonFence(content);
  try {
    return normalizeParsedJson(JSON.parse(trimmed));
  } catch (_error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(FORMAT_ERROR);
    return normalizeParsedJson(JSON.parse(match[0]));
  }
}

function stripJsonFence(content) {
  return String(content || "").trim().replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
}

function normalizeParsedJson(value) {
  if (typeof value === "string") return parseJsonContent(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(FORMAT_ERROR);
  return value;
}

function cleanText(value) {
  return stripLeakedReasoning(String(value || "").replace(/\s+/g, " ").trim());
}

function stripLeakedReasoning(text) {
  const cleaned = String(text || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<\/?think>/gi, "")
    .trim();
  const marker = cleaned.search(/(?:##\s*角色|##\s*任务|##\s*输出格式|生成前先判断|自检|我们需要|我需要|先看|现在来|输出严格 JSON)/);
  return (marker >= 0 ? cleaned.slice(0, marker) : cleaned).trim();
}

function looksLikeReasoningLeak(text) {
  return /(?:生成前先判断|岗位最重要|候选人与之最匹配|自检|我们需要|我需要|先看|现在来|输出严格 JSON|只输出严格 JSON)/.test(String(text || ""));
}
