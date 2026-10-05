/**
 * 人岗匹配服务：只负责 Match，不负责生成简历修改建议。
 *
 * Match 只消费已结构化的 Job Profile + Resume Profile，因此默认关闭额外 reasoning。
 * 若最终结构化结果因 max_output_tokens / incomplete JSON 未完成，只自动执行一次
 * Compact Retry：仍关闭 reasoning，使用稍高输出预算，并要求优先完成紧凑 JSON。
 */
import { logApiError } from "../../shared/ai/debug.js";
import { buildTaskContext } from "../../shared/context/builders.js";
import { attachJsonSchemaFormat, postResponses, validateModelSettings } from "../../shared/ai/client.js";
import { isResumeMatchRetryableError } from "../../shared/ai/errors.js";
import { extractResponseContent, extractTokenUsage } from "../../shared/ai/response.js";
import { MODEL_INPUT_LIMITS, MODEL_REASONING_EFFORT, MODEL_TOKEN_LIMITS } from "../../shared/ai/token-limits.js";
import { RESUME_MATCH_RESPONSE_SCHEMA, resumeMatchMessages } from "./prompt.js";
import { parseResumeMatchResponse } from "./response.js";

// 只负责“匹配分析”。修改建议是独立的 resume-revision 任务，拥有自己的 UI 状态机。
export async function analyzeResumeMatchWithAi({ job, resume, settings, context = buildTaskContext({ task: "resume_match", job, resume }) }) {
  validateResumeMatchInput(job, resume, settings, context);

  try {
    return await runMatchAttempt({
      label: "resume-match:first",
      settings,
      context,
      outputTokens: MODEL_TOKEN_LIMITS.resumeMatch.outputTokens,
      reasoningEffort: MODEL_REASONING_EFFORT.resumeMatch,
      compact: false,
      attempt: 1
    });
  } catch (error) {
    if (!isResumeMatchRetryableError(error)) throw error;

    return runMatchAttempt({
      label: "resume-match:retry",
      settings,
      context,
      outputTokens: MODEL_TOKEN_LIMITS.resumeMatch.retryOutputTokens,
      reasoningEffort: MODEL_REASONING_EFFORT.resumeMatchRetry,
      compact: true,
      attempt: 2,
      firstFailure: error
    });
  }
}

async function runMatchAttempt({
  label,
  settings,
  context,
  outputTokens,
  reasoningEffort,
  compact,
  attempt,
  firstFailure = null
}) {
  const requestBody = attachJsonSchemaFormat({
    model: settings.model.trim(),
    temperature: 0.2,
    reasoning_effort: reasoningEffort,
    max_tokens: outputTokens,
    messages: resumeMatchMessages(context.input, { compact })
  }, RESUME_MATCH_RESPONSE_SCHEMA, "resume_match_analysis");

  const payload = await postResponses({
    label,
    settings,
    body: requestBody,
    errorPrefix: "分析失败"
  });
  try {
    return {
      ...parseResumeMatchResponse(payload),
      revisions: [],
      revisionError: null,
      usage: extractTokenUsage(payload),
      reliability: {
        attempts: attempt,
        retried: attempt > 1,
        ...(firstFailure ? {
          firstFailureCode: firstFailure.code || firstFailure.name || "unknown",
          firstFailureReason: firstFailure.reason || "unknown"
        } : {})
      }
    };
  } catch (error) {
    logApiError(`${label}-parse`, {
      message: error.message,
      content: extractResponseContent(payload)
    });
    throw error;
  }
}

function validateResumeMatchInput(job, resume, settings, context) {
  const jdLength = String(job && job.description || "").trim().length;
  if (!job || !jdLength) throw new Error("当前岗位描述为空，无法进行简历匹配分析。");
  if (context.stats.job === "raw" && jdLength > MODEL_INPUT_LIMITS.jobDescriptionChars) throw new Error("当前岗位描述超过 5000 字，无法进行简历匹配分析。");
  if (!resume?.profile || context.stats.resume !== "profile") throw new Error("请先完成简历理解，再进行匹配分析。");
  validateModelSettings(settings);
}
