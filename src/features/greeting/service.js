/**
 * 开场白生成服务：仅消费已筛选的匹配亮点和用户文案参数。
 * 请求格式兼容、错误处理统一交给 shared/ai/client.js。
 */
import { logApiError } from "../../shared/ai/debug.js";
import { buildTaskContext } from "../../shared/context/builders.js";
import { attachJsonSchemaFormat, postResponses, validateModelSettings } from "../../shared/ai/client.js";
import { extractResponseContent, extractTokenUsage } from "../../shared/ai/response.js";
import { greetingOutputTokens, MODEL_REASONING_EFFORT } from "../../shared/ai/token-limits.js";
import { GREETING_RESPONSE_SCHEMA, greetingMessages } from "./prompt.js";
import { parseGreetingResponse } from "./response.js";

export async function generateGreetingWithAi({ job, resume, tone, maxChars, settings, context = buildTaskContext({ task: "greeting", job, resume, tone, maxChars }) }) {
  validateModelSettings(settings);

  const requestBody = attachJsonSchemaFormat({
    model: settings.model.trim(),
    temperature: 0.45,
    reasoning_effort: MODEL_REASONING_EFFORT.greeting,
    max_tokens: greetingOutputTokens(maxChars),
    messages: greetingMessages(context.input)
  }, GREETING_RESPONSE_SCHEMA, "job_application_greeting");

  const payload = await postResponses({
    label: "greeting",
    settings,
    body: requestBody,
    errorPrefix: "生成失败"
  });
  try {
    return {
      ...parseGreetingResponse(payload),
      usage: extractTokenUsage(payload)
    };
  } catch (error) {
    logApiError("greeting-parse", {
      message: error.message,
      content: extractResponseContent(payload)
    });
    throw error;
  }
}
