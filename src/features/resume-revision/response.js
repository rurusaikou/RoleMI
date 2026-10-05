/**
 * 修改建议响应解析：规范化建议字段，区分合法空列表与空输出或损坏 JSON。
 */
import { extractResponseContent } from "../../shared/ai/response.js";
import { AiOutputFormatError } from "../../shared/ai/errors.js";

export function parseResumeRevisionResponse(payload) {
  const content = extractResponseContent(payload);
  if (!content.trim()) throw new AiOutputFormatError("修改建议生成失败：模型返回为空。", { reason: "empty_output" });
  try {
    const data = unwrapResultObject(parseJsonContent(content));
    return normalizeRevisionBlocks(data.revisions || data["简历修改建议"] || data["修改建议"]);
  } catch (_error) {
    throw new AiOutputFormatError("修改建议生成失败：模型返回格式异常。", { reason: "incomplete_json" });
  }
}

function parseJsonContent(content) {
  if (typeof content !== "string" || !content.trim()) throw new Error("empty");
  const trimmed = content.trim().replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  try {
    return normalizeParsedJson(JSON.parse(trimmed));
  } catch (_error) {
    const objects = extractJsonObjects(trimmed);
    for (let index = objects.length - 1; index >= 0; index -= 1) {
      try { return normalizeParsedJson(JSON.parse(objects[index])); } catch (_innerError) {}
    }
    throw new Error("not json");
  }
}

function normalizeParsedJson(value) {
  if (typeof value === "string") return parseJsonContent(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not object");
  return value;
}

function unwrapResultObject(value) {
  const candidates = [value.result, value.data, value.analysis, value["分析结果"], value["修改建议"]];
  return candidates.find((item) => item && typeof item === "object" && !Array.isArray(item)) || value;
}

function extractJsonObjects(text) {
  const objects = [];
  let start = -1, depth = 0, inString = false, escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) { escaped = false; continue; }
      if (char === "\\") { escaped = true; continue; }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') { inString = true; continue; }
    if (char === "{") { if (depth === 0) start = index; depth += 1; continue; }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) { objects.push(text.slice(start, index + 1)); start = -1; }
    }
  }
  return objects;
}

function normalizeRevisionBlocks(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => ({
    summary: cleanText(item?.summary || item?.["总述"] || item?.["修改目的"]),
    original: cleanText(item?.original || item?.["原内容"]),
    category: cleanText(item?.category || item?.["问题类别"]),
    reason: cleanText(item?.reason || item?.direction || item?.["建议方向"] || item?.["修改依据"] || item?.["待补充信息"]),
    rewrite: cleanText(item?.rewrite || item?.["可改为"] || item?.["建议改写"])
  })).filter((item) => Object.values(item).some(Boolean));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
