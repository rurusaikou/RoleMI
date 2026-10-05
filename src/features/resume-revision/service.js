/**
 * 简历修改建议服务：在 Match 已成功的前提下独立生成 Revision。
 * 请求格式兼容、错误处理统一交给 shared/ai/client.js。
 */
import { logApiError } from "../../shared/ai/debug.js";
import { isResumeRevisionRetryableError } from "../../shared/ai/errors.js";
import { attachJsonSchemaFormat, postResponses } from "../../shared/ai/client.js";
import { extractTokenUsage } from "../../shared/ai/response.js";
import { MODEL_REASONING_EFFORT, MODEL_TOKEN_LIMITS } from "../../shared/ai/token-limits.js";
import { RESUME_REVISION_RESPONSE_SCHEMA, resumeRevisionMessages } from "./prompt.js";
import { parseResumeRevisionResponse } from "./response.js";

export async function generateResumeRevisions({ settings, resumeProfile, matchResult, job }) {
  const input = { settings, resumeProfile, matchResult, job };
  try {
    return await runRevisionAttempt({ ...input, compact: false });
  } catch (error) {
    if (!isResumeRevisionRetryableError(error)) throw error;
    return runRevisionAttempt({ ...input, compact: true });
  }
}

async function runRevisionAttempt({ settings, resumeProfile, matchResult, job, compact }) {
  const label = compact ? "resume-revisions:retry" : "resume-revisions";
  try {
    const body = attachJsonSchemaFormat({
      model: settings.model.trim(),
      temperature: 0.2,
      reasoning_effort: compact ? MODEL_REASONING_EFFORT.resumeRevisionRetry : MODEL_REASONING_EFFORT.resumeRevision,
      max_tokens: compact ? MODEL_TOKEN_LIMITS.resumeMatch.revisionRetryOutputTokens : MODEL_TOKEN_LIMITS.resumeMatch.revisionOutputTokens,
      messages: resumeRevisionMessages({ resumeProfile }, matchResult, job, { compact })
    }, RESUME_REVISION_RESPONSE_SCHEMA, "resume_revision_suggestions");

    const payload = await postResponses({
      label,
      settings,
      body,
      errorPrefix: "修改建议生成失败"
    });

    return {
      revisions: parseResumeRevisionResponse(payload),
      revisionUsage: extractTokenUsage(payload),
      revisionError: null
    };
  } catch (error) {
    logApiError(label, { message: error.message });
    throw error;
  }
}
