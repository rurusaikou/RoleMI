import test from "node:test";
import assert from "node:assert/strict";
import { installStorage, legacyJob, resumeText, analysisResult, responseFor } from "./helpers.mjs";
import { setJobs } from "../src/features/jobs/repository.js";
import { setResume, saveResumeProfile } from "../src/features/resume/storage.js";
import { structureResumeText } from "../src/features/resume/extractor.js";
import { buildTaskContext } from "../src/shared/context/builders.js";
import { resultMetadata } from "../src/shared/context/cache.js";
import { analyzeResumeMatchWithAi } from "../src/features/resume-match/service.js";
import { MODEL_TOKEN_LIMITS } from "../src/shared/ai/token-limits.js";

const settings = { apiKey: "fake-test-key-value", model: "test-model", baseUrl: "https://example.test/v1" };

async function fixture() {
  installStorage();
  let [job] = await setJobs([legacyJob]);
  let resume = await setResume(structureResumeText(resumeText, { fileName: "cv.pdf" }));
  resume = await saveResumeProfile(resume, {
    jobIntent: "产品经理",
    location: "",
    education: [],
    workExperience: [{ organization: "公司A", role: "产品经理", period: "2022-2024", details: ["负责知识库产品规划并协同算法研发上线。"], technologies: [] }],
    projects: [],
    skills: ["需求分析", "RAG"],
    certifications: [],
    languages: [],
    otherEvidence: []
  });
  const deepContext = buildTaskContext({ task: "deep_analysis", job });
  [job] = await setJobs([{ ...job, deepAnalysis: { ...analysisResult, ...resultMetadata(deepContext) } }]);
  return { job, resume, context: buildTaskContext({ task: "resume_match", job, resume }) };
}

const successfulMatch = {
  overall: { level: "中匹配", reason: "具备相关 AI 应用经验，但平台产品经验仍有限。" },
  directMatches: [{ requirement: "AI 应用经验", experience: "知识库产品规划与上线", proof: "协同算法研发完成产品上线" }],
  transferableMatches: [],
  gaps: [{ gap: "B端平台产品经验", impact: "岗位核心职责要求平台化产品建设经验" }]
};

test("Resume Match 默认关闭 reasoning，max_output_tokens 截断时只 Compact Retry 一次", async () => {
  const { job, resume, context } = await fixture();
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
          usage: { input_tokens: 2500, output_tokens: 3500, total_tokens: 6000 }
        })
      };
    }
    return responseFor(successfulMatch);
  };

  const result = await analyzeResumeMatchWithAi({ job, resume, settings, context });
  assert.equal(requestCount, 2);
  assert.equal(sent[0].reasoning?.effort, "none");
  assert.equal(sent[1].reasoning?.effort, "none");
  assert.equal(sent[0].max_output_tokens, MODEL_TOKEN_LIMITS.resumeMatch.outputTokens);
  assert.equal(sent[1].max_output_tokens, MODEL_TOKEN_LIMITS.resumeMatch.retryOutputTokens);
  assert.doesNotMatch(JSON.stringify(sent[0].input), /Compact Retry/);
  assert.match(JSON.stringify(sent[1].input), /Compact Retry/);
  assert.match(JSON.stringify(sent[1].input), /优先保证所有必填字段完整/);
  assert.equal(result.reliability.attempts, 2);
  assert.equal(result.reliability.retried, true);
  assert.equal(result.level, "中匹配");
});

test("Resume Match 完整状态但 JSON 未完成时也使用 Compact Retry", async () => {
  const { job, resume, context } = await fixture();
  let requestCount = 0;
  globalThis.fetch = async () => {
    requestCount += 1;
    if (requestCount === 1) {
      return {
        ok: true,
        json: async () => ({ status: "completed", output_text: '{"overall":{"level":"中匹配"', usage: {} })
      };
    }
    return responseFor(successfulMatch);
  };

  const result = await analyzeResumeMatchWithAi({ job, resume, settings, context });
  assert.equal(requestCount, 2);
  assert.equal(result.level, "中匹配");
});
