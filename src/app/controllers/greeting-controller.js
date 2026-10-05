/**
 * 开场白参数、状态同步、生成与复制交互。
 * Controller 只连接 DOM、State 与业务动作，不包含 Prompt / Provider 细节。
 */
import { resumeBlockingMessage, isResultCurrent, taskKey } from "../../shared/context/cache.js";
import { copyText, qs } from "../../shared/ui/dom.js";
import { currentJob, requests, state } from "../runtime.js";
import { runGreeting } from "../task-runner.js";

let actions = { refresh: () => {}, setStep: () => {} };
let greetingDraft = "";
let greetingDraftSource = "";

export function configureGreetingController(nextActions = {}) {
  actions = { ...actions, ...nextActions };
}

export function greetingOptions() {
  return { tone: qs("#greetingTone").value, maxChars: greetingLengthLimit() };
}

export function syncGreetingState() {
  const job = currentJob();
  const resume = state.resumeState.data;
  const options = greetingOptions();
  const key = taskKey("greeting", { job, resume, ...options });
  const ticket = key ? requests.get("greeting", job.id, key) : null;
  if (ticket?.loading) {
    Object.assign(state.tasks.greeting, { status: "loading", error: null });
    return;
  }
  if (ticket?.error) {
    Object.assign(state.tasks.greeting, { status: "error", error: ticket.error, result: "" });
    return;
  }
  const stored = isResultCurrent("greeting", job.greeting, { job, resume, ...options }) ? job.greeting : null;
  if (stored) {
    Object.assign(state.tasks.greeting, { status: "success", error: null, result: stored.result.greeting || "" });
  } else {
    Object.assign(state.tasks.greeting, { status: "idle", error: null, result: "" });
  }
}

export function renderGreeting() {
  syncGreetingState();
  const match = state.tasks.resumeMatch;
  const greeting = state.tasks.greeting;
  const uploaded = state.resumeState.uploaded;
  const canGenerate = Boolean(!resumeBlockingMessage(state.resumeState.data) && uploaded && match.status === "success" && match.result);
  qs("#greetingPrompt").classList.toggle("is-hidden", canGenerate);
  qs("#greetingResult").classList.toggle("is-hidden", !canGenerate);
  const textArea = qs("#greetingText");
  const isLoading = greeting.status === "loading";
  qs("#greetingLoading").classList.toggle("is-hidden", !isLoading);
  textArea.classList.toggle("is-hidden", isLoading);
  if (isLoading) {
    textArea.value = "";
    textArea.disabled = true;
  } else {
    textArea.disabled = false;
    if (greeting.result !== greetingDraftSource) {
      greetingDraftSource = greeting.result || "";
      greetingDraft = greetingDraftSource;
    }
    textArea.value = greetingDraft;
  }
  qs("#copyStatus").textContent = greeting.status === "error" ? greeting.error || "" : "";
  updateGreetingControls();

  if (resumeBlockingMessage(state.resumeState.data)) {
    qs("#greetingPrompt h2").textContent = "当前文档无法用于分析";
    qs("#greetingPrompt p").textContent = resumeBlockingMessage(state.resumeState.data);
    qs("#goMatchUploadBtn").textContent = "去更换简历";
  } else if (!uploaded) {
    qs("#greetingPrompt h2").textContent = "先上传简历";
    qs("#greetingPrompt p").textContent = "求职开场白会基于岗位描述和简历匹配亮点生成。请先在“匹配”中上传简历。";
    qs("#goMatchUploadBtn").textContent = "去上传简历";
  } else if (match.status === "loading") {
    qs("#greetingPrompt h2").textContent = "正在匹配分析";
    qs("#greetingPrompt p").textContent = "匹配分析完成后，会基于匹配亮点生成求职开场白。";
    qs("#goMatchUploadBtn").textContent = "查看匹配进度";
  } else if (!canGenerate) {
    qs("#greetingPrompt h2").textContent = "先完成匹配分析";
    qs("#greetingPrompt p").textContent = "求职开场白需要基于简历与岗位的匹配亮点生成。请先完成匹配分析。";
    qs("#goMatchUploadBtn").textContent = "去匹配分析";
  }
}

export async function startGreetingGeneration() {
  syncGreetingState();
  if (state.tasks.resumeMatch.status !== "success" || !state.tasks.resumeMatch.result || state.tasks.greeting.status === "loading" || state.resumeState.parsing) return;
  if (greetingDraftSource && greetingDraft !== greetingDraftSource) {
    const confirmed = window.confirm("重新生成将覆盖当前修改内容，是否继续？");
    if (!confirmed) return;
  }
  greetingDraft = "";
  greetingDraftSource = "";
  await runGreeting(currentJob(), greetingOptions(), { onUpdate: actions.refresh });
}

function updateGreetingControls() {
  const button = qs("#generateGreetingBtn");
  if (!button) return;
  const greeting = state.tasks.greeting;
  const matchReady = state.tasks.resumeMatch.status === "success" && Boolean(state.tasks.resumeMatch.result);
  button.disabled = greeting.status === "loading" || !matchReady || Boolean(state.resumeState.parsing);
  button.textContent = greeting.status === "loading" ? "生成中" : greeting.result ? "↻ 重新生成" : "生成开场白";
  qs("#copyGreetingBtn").disabled = greeting.status === "loading" || !greeting.result;
}

function markGreetingConstraintChanged() {
  requests.invalidate("greeting", currentJob().id);
  actions.refresh();
  if (!state.tasks.greeting.result) qs("#copyStatus").textContent = "沟通风格或内容长度已调整，点击生成后生效。";
}

function greetingLengthLimit() {
  return Number(qs("#greetingLength").value) || 180;
}

export function bindGreetingEvents() {
  qs("#toGreetingBtn").addEventListener("click", async () => {
    actions.setStep("greeting");
    if (state.tasks.resumeMatch.status === "success" && !state.tasks.greeting.result) await startGreetingGeneration();
  });
  qs("#goMatchUploadBtn").addEventListener("click", () => actions.setStep("match"));
  qs("#generateGreetingBtn").addEventListener("click", startGreetingGeneration);
  qs("#greetingTone").addEventListener("change", markGreetingConstraintChanged);
  qs("#greetingLength").addEventListener("change", markGreetingConstraintChanged);
  qs("#greetingText").addEventListener("input", (event) => {
    greetingDraft = event.target.value;
  });
  qs("#copyGreetingBtn").addEventListener("click", () => {
    const copied = copyText(qs("#greetingText").value.trim());
    qs("#copyStatus").textContent = copied ? "已复制到剪贴板。" : "浏览器限制了复制权限，请手动选中文案复制。";
  });
}
