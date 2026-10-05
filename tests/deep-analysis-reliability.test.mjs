import test from "node:test";
import assert from "node:assert/strict";
import { installStorage, legacyJob, analysisResult, responseFor } from "./helpers.mjs";
import { setJobs } from "../src/features/jobs/repository.js";
import { analyzeJobWithAi } from "../src/features/jd-analysis/service.js";
import { buildDeepAnalysisRetryContext, buildTaskContext } from "../src/shared/context/builders.js";
import { MODEL_INPUT_LIMITS, MODEL_TOKEN_LIMITS } from "../src/shared/ai/token-limits.js";
import { AiOutputFormatError, AiResponseIncompleteError, deepAnalysisUserMessage, isDeepAnalysisRetryableError } from "../src/shared/ai/errors.js";
import { getDeepAnalysisReliabilityStats, resetDeepAnalysisReliabilityStats } from "../src/shared/ai/debug.js";

const settings = { apiKey: "fake-test-key-value", model: "test-model", baseUrl: "https://example.test/v1" };

async function longJobFixture() {
  installStorage();
  const blocks = [
    "岗位职责：负责 AI 产品规划、需求分析、跨团队协作和核心指标优化。",
    "任职要求：3 年产品经验，理解大模型能力边界，具备数据分析能力。",
    "加分项：有 Agent、RAG、模型评测或企业服务经验。",
    ...Array.from({ length: 120 }, (_, i) => `业务说明${i}：围绕用户问题解决率持续优化产品体验，并与算法研发协同推进项目落地。`)
  ];
  const description = blocks.join("\n").slice(0, 4800);
  const [job] = await setJobs([{ ...legacyJob, description }]);
  return job;
}

test("Deep Analysis 仅在输出截断时自动重试一次，并使用更高预算与更紧凑 Context", async () => {
  const job = await longJobFixture();
  resetDeepAnalysisReliabilityStats();
  const sent = [];
  let requestCount = 0;
  globalThis.fetch = async (_url, request) => {
    sent.push(JSON.parse(request.body));
    requestCount += 1;
    if (requestCount === 1) {
      return {
        ok: true,
        json: async () => ({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [{ type: "reasoning" }],
          usage: { input_tokens: 1000, output_tokens: 4000, total_tokens: 5000 }
        })
      };
    }
    return responseFor(analysisResult);
  };

  const primaryContext = buildTaskContext({ task: "deep_analysis", job });
  const result = await analyzeJobWithAi(job, settings, primaryContext);

  assert.equal(requestCount, 2);
  assert.equal(sent[0].reasoning.effort, "none");
  assert.equal(sent[1].reasoning.effort, "none");
  assert.equal(sent[0].max_output_tokens, 4000);
  assert.equal(sent[1].max_output_tokens, MODEL_TOKEN_LIMITS.deepAnalysis.retryOutputTokens);
  assert.ok(JSON.stringify(sent[1].input).length < JSON.stringify(sent[0].input).length);
  assert.match(JSON.stringify(sent[1].input), /紧凑重试/);
  assert.match(JSON.stringify(sent[1].input), /重新生成完整JSON/);
  assert.equal(result.reliability.attempts, 2);
  assert.equal(result.reliability.retried, true);
  assert.deepEqual(getDeepAnalysisReliabilityStats(), {
    firstAttempt: 1, retry: 1, finalFailure: 0, updatedAt: getDeepAnalysisReliabilityStats().updatedAt
  });
  assert.ok(getDeepAnalysisReliabilityStats().updatedAt);
});

test("Retry Context 保留高信号 JD 信息并限制描述长度", async () => {
  const job = await longJobFixture();
  const retryContext = buildDeepAnalysisRetryContext(job);
  assert.ok(retryContext.input.description.length <= MODEL_INPUT_LIMITS.deepAnalysisRetryDescriptionChars);
  assert.match(retryContext.input.description, /岗位职责/);
  assert.match(retryContext.input.description, /任职要求/);
  assert.match(retryContext.input.description, /加分项/);
  assert.equal(retryContext.stats.job, "retry-compact");
});

test("max_output_tokens 与 incomplete JSON 都被识别为可恢复错误，UI 使用非技术提示", () => {
  const maxTokens = new AiResponseIncompleteError("technical", { reason: "max_output_tokens" });
  const incompleteJson = new AiOutputFormatError("technical", { reason: "incomplete_json" });
  const other = new AiResponseIncompleteError("technical", { reason: "content_filter" });

  assert.equal(isDeepAnalysisRetryableError(maxTokens), true);
  assert.equal(isDeepAnalysisRetryableError(incompleteJson), true);
  assert.equal(isDeepAnalysisRetryableError(other), false);
  assert.equal(deepAnalysisUserMessage(maxTokens), "分析未完成，请重新分析。");
  assert.equal(deepAnalysisUserMessage(incompleteJson), "分析未完成，请重新分析。");
});


test("Deep Analysis 最终失败会计入 finalFailure，且不会继续第三次重试", async () => {
  const job = await longJobFixture();
  resetDeepAnalysisReliabilityStats();
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    return {
      ok: true,
      json: async () => ({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [{ type: "reasoning" }],
        usage: { input_tokens: 1000, output_tokens: 4000, total_tokens: 5000 }
      })
    };
  };

  await assert.rejects(analyzeJobWithAi(job, settings), /模型返回未完成/);
  assert.equal(requestCount, 2);
  const stats = getDeepAnalysisReliabilityStats();
  assert.equal(stats.firstAttempt, 1);
  assert.equal(stats.retry, 1);
  assert.equal(stats.finalFailure, 1);
});

test("完整状态但 JSON 被截断时也会自动 Retry", async () => {
  const job = await longJobFixture();
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return {
        ok: true,
        json: async () => ({ status: "completed", output_text: '{"essence":["岗位本质"],"coreRequirements":[', usage: {} })
      };
    }
    return responseFor(analysisResult);
  };

  const result = await analyzeJobWithAi(job, settings);
  assert.equal(requestCount, 2);
  assert.deepEqual(result.essence, analysisResult.essence);
});
