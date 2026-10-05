/**
 * 简历上传/清除，以及 Match / Revision 两个 Task State 的 UI 渲染。
 * Controller 只连接 DOM、State 与业务动作，不包含 Prompt / Provider 细节。
 */
import { clearCurrentResume, handleResumeFile, renderResumeStatus, restoreResume } from "../../features/resume/workflow.js";
import { renderResumeMatchView } from "../../features/resume-match/view.js";
import { resumeBlockingMessage } from "../../shared/context/cache.js";
import { qs } from "../../shared/ui/dom.js";
import { currentJob, resetResumeDependentTasks, state, syncTaskState } from "../runtime.js";
import { runResumePipeline, runResumeRevision, runResumeUnderstanding } from "../task-runner.js";

let actions = { refresh: () => {}, setStep: () => {} };

export function configureResumeController(nextActions = {}) {
  actions = { ...actions, ...nextActions };
}

/** 同步 Match / Revision Task State 后刷新简历流程页面。 */
export function renderResumeFlow() {
  syncTaskState();
  const uploaded = state.resumeState.uploaded;
  const resumeBusy = Boolean(state.resumeState.parsing || state.resumeState.understanding);
  qs("#resumeFile").disabled = resumeBusy;
  qs("#resumeUploadControl").setAttribute("aria-disabled", String(resumeBusy));
  qs("#matchUploadPrompt").classList.remove("is-hidden");
  qs("#matchResults").classList.toggle("is-hidden", !uploaded);
  qs("#clearResumeBtn").disabled = !uploaded || resumeBusy;
  qs("#resumeUploadLabel").textContent = uploaded ? "更换简历" : "上传简历";
  qs("#resumeFileName").textContent = state.resumeState.data?.source?.fileName || "尚未选择文件";
  renderResumeStatus(state);
  renderResumeMatchView(state);
  renderRevisionStep();
}

/**
 * Revision 页面只读取显式状态机：
 * Match 未成功时给前置提示；Match 成功后 Revision 自己处理 loading/success/error。
 */
export function renderRevisionStep() {
  const uploaded = state.resumeState.uploaded;
  const match = state.tasks.resumeMatch;
  const revision = state.tasks.resumeRevision;
  const hasMatch = match.status === "success" && Boolean(match.result);
  const prompt = qs("#revisionPrompt");
  const promptText = qs("#revisionPromptText");
  prompt.classList.toggle("is-hidden", hasMatch);

  if (resumeBlockingMessage(state.resumeState.data)) {
    prompt.classList.remove("is-hidden");
    promptText.textContent = resumeBlockingMessage(state.resumeState.data);
    return;
  }
  if (!uploaded) {
    promptText.textContent = "上传简历并完成匹配分析后，这里会展示针对当前岗位的简历修改建议。";
    return;
  }
  if (match.status === "loading") {
    promptText.textContent = "正在分析简历与岗位匹配情况，完成后会继续生成修改建议。";
    return;
  }
  if (match.status === "error") {
    promptText.textContent = "匹配分析失败，回到“匹配”页重新分析后再查看修改建议。";
    return;
  }
  if (!hasMatch) {
    promptText.textContent = "简历已上传。请先在“匹配”页开始分析，完成后这里会展示修改建议。";
    return;
  }
  if (revision.status === "loading") {
    promptText.textContent = "匹配分析已完成，正在生成简历修改建议。";
    return;
  }
  if (revision.status === "error") {
    promptText.textContent = revision.error || "修改建议生成失败，请重新分析。";
    return;
  }
  if (revision.status === "success") {
    promptText.textContent = "修改建议已生成。";
  }
}

/** 用户触发 Match；后续 Revision 由 task-runner 在 Match 成功后继续编排。 */
export async function startResumeMatchAnalysis() {
  if (!state.resumeState.uploaded || !state.resumeState.data || state.resumeState.parsing || state.resumeState.understanding) return;
  await runResumePipeline(currentJob(), { onUpdate: actions.refresh });
}

export function resetResumeFlow() {
  resetResumeDependentTasks();
  actions.refresh();
}

export async function restoreResumeState() {
  await restoreResume(state, { updateMatchState: actions.refresh, setStep: actions.setStep });
}

export function bindResumeEvents() {
  qs("#suggestList").addEventListener("click", async (event) => {
    if (!event.target.closest("#retryRevisionBtn")) return;
    if (state.resumeState.parsing || state.resumeState.understanding) return;
    await runResumeRevision(currentJob(), { onUpdate: actions.refresh });
  });
  qs("#resumeFile").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (file && !state.resumeState.parsing && !state.resumeState.understanding) {
      resetResumeDependentTasks();
      const uploaded = await handleResumeFile(state, file, { updateMatchState: actions.refresh, setStep: actions.setStep });
      // 上传成功后立即前置计算并缓存 Resume Profile，但不自动启动 Match。
      // Match 仍由用户显式触发；若 Profile 生成失败，点击 Match 时会自动重试依赖补齐。
      if (uploaded) await runResumeUnderstanding({ onUpdate: actions.refresh });
    }
  });

  qs("#clearResumeBtn").addEventListener("click", async () => {
    if (state.resumeState.parsing || state.resumeState.understanding) return;
    resetResumeDependentTasks();
    await clearCurrentResume(state, { updateMatchState: actions.refresh, setStep: actions.setStep });
  });

  qs("#analyzeResumeMatchBtn").addEventListener("click", startResumeMatchAnalysis);
  qs("#toRevisionBtn").addEventListener("click", () => actions.setStep("revision"));
  qs("#goRevisionMatchBtn").addEventListener("click", () => actions.setStep("match"));
}
