/**
 * Resume Understanding：把一次上传的 Raw Resume 转成可复用的结构化事实档案。
 * 该请求按 Resume contentVersion 缓存；同一份简历不会在每次 Match 时重复调用。
 */
import { logApiError } from "../../shared/ai/debug.js";
import { attachJsonSchemaFormat, postResponses, validateModelSettings } from "../../shared/ai/client.js";
import { extractResponseContent, extractTokenUsage } from "../../shared/ai/response.js";
import { MODEL_INPUT_LIMITS, MODEL_REASONING_EFFORT, MODEL_TOKEN_LIMITS } from "../../shared/ai/token-limits.js";
import { RESUME_PROFILE_RESPONSE_SCHEMA, resumeProfileMessages } from "./profile-prompt.js";
import { parseResumeProfileResponse } from "./profile-response.js";

export async function buildResumeProfileWithAi({ resume, settings }) {
  const rawText = String(resume?.rawText || "").trim();
  if (!resume?.id || !resume?.contentVersion || !rawText) throw new Error("请先上传可读取文本的简历。");
  if (rawText.length > MODEL_INPUT_LIMITS.resumeProfileChars) {
    throw new Error(`当前简历超过 ${MODEL_INPUT_LIMITS.resumeProfileChars} 字，暂无法完成简历理解。`);
  }
  validateModelSettings(settings);

  const requestBody = attachJsonSchemaFormat({
    model: settings.model.trim(),
    temperature: 0.1,
    reasoning_effort: MODEL_REASONING_EFFORT.resumeProfile,
    max_tokens: MODEL_TOKEN_LIMITS.resumeProfile.outputTokens,
    messages: resumeProfileMessages(rawText)
  }, RESUME_PROFILE_RESPONSE_SCHEMA, "resume_profile");

  const payload = await postResponses({
    label: "resume-profile",
    settings,
    body: requestBody,
    errorPrefix: "简历理解失败"
  });

  try {
    return { ...parseResumeProfileResponse(payload), usage: extractTokenUsage(payload) };
  } catch (error) {
    logApiError("resume-profile-parse", {
      message: error.message,
      content: extractResponseContent(payload)
    });
    throw error;
  }
}
