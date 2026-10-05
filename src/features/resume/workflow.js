/**
 * 简历上传与恢复流程：协调本地解析、保存、状态展示和导入埋点。
 * 上传成功后由 Controller 触发理解；恢复本地数据不自动启动匹配。
 */
import { startUsage } from "../../shared/backend/usage.js";
import { qs } from "../../shared/ui/dom.js";
import { structureResumeText } from "./extractor.js";
import { parseResumeFile } from "./parser.js";
import { resumeBlockingMessage, reusableResumeProfile } from "../../shared/context/cache.js";
import { clearResume, getResume, setResume } from "./storage.js";

const EMPTY_RESUME_MESSAGE = "当前还没有简历。支持 PDF / DOCX，提取文本不超过 4000 字；超限不进入分析。";

// 返回 true 只表示本地解析及保存成功；Controller 随后启动 Resume Understanding，不自动 Match。
export async function handleResumeFile(state, file, callbacks) {
  const finishUsage = startUsage("resume_import");
  const input = qs("#resumeFile");
  qs("#resumeFileName").textContent = file.name;
  qs("#resumeStatus").textContent = `正在解析：${file.name}...`;
  input.disabled = true;
  state.resumeState.parsing = true;
  state.resumeState.uploadError = null;
  state.resumeState.profileError = null;
  callbacks.updateMatchState();

  try {
    const parsed = await parseResumeFile(file);
    const resume = structureResumeText(parsed.text, {
      fileName: file.name,
      fileType: parsed.fileType
    });
    state.resumeState.data = await setResume(resume);
    state.resumeState.uploadError = null;
    markResumeReady(state, file.name, callbacks);
    finishUsage(!resumeBlockingMessage(state.resumeState.data));
    return !resumeBlockingMessage(state.resumeState.data);
  } catch (error) {
    finishUsage(false);
    state.resumeState.uploaded = Boolean(state.resumeState.data);
    // 错误必须进入 State；直接写 DOM 会被紧随其后的全局 refresh 用默认文案覆盖。
    state.resumeState.uploadError = error.message || "简历解析失败，请换一个 PDF 或 DOCX 文件。";
    callbacks.updateMatchState();
    return false;
  } finally {
    input.disabled = false;
    // 清空文件选择，让用户再次选择同一个文件时仍能触发 change。
    input.value = "";
    state.resumeState.parsing = false;
    callbacks.updateMatchState();
  }
}

// 恢复时只加载本地简历；失效或缺失的 Profile 留待用户发起 Match 时补齐。
export async function restoreResume(state, callbacks) {
  state.resumeState.uploadError = null;
  state.resumeState.data = await getResume();
  if (!state.resumeState.data) {
    renderEmptyResume();
    callbacks.updateMatchState();
    return;
  }

  state.resumeState.uploaded = true;
  renderResumeStatus(state);
  callbacks.updateMatchState();
}

export async function clearCurrentResume(state, callbacks) {
  state.resumeState.parsing = true;
  qs("#resumeFile").disabled = true;
  callbacks.updateMatchState();
  try {
    state.resumeState.data = await clearResume();
    state.resumeState.uploaded = false;
    state.resumeState.understanding = false;
    state.resumeState.uploadError = null;
    state.resumeState.profileError = null;
    renderEmptyResume();
    callbacks.setStep("match");
  } catch (error) {
    qs("#resumeStatus").textContent = error.message || "清除简历失败，请重试。";
  } finally {
    state.resumeState.parsing = false;
    qs("#resumeFile").disabled = false;
    callbacks.updateMatchState();
  }
}

export function renderResumeStatus(state) {
  const resume = state.resumeState.data;
  const status = qs("#resumeStatus");
  status.classList.remove("is-hidden");
  status.classList.toggle("error", Boolean(state.resumeState.uploadError || resumeBlockingMessage(resume)));
  if (state.resumeState.uploadError) {
    status.textContent = state.resumeState.uploadError;
    return;
  }
  if (!resume) {
    renderEmptyResume();
    return;
  }
  const label = resume.source?.fileName || "本地简历";
  const length = String(resume.rawText || "").length;
  if (state.resumeState.parsing) {
    qs("#resumeStatus").textContent = `正在解析：${label}...`;
    return;
  }
  if (state.resumeState.understanding) {
    qs("#resumeStatus").textContent = `已提取 ${length} 字，正在理解简历内容...`;
    return;
  }
  if (resumeBlockingMessage(resume)) {
    qs("#resumeStatus").textContent = resumeBlockingMessage(resume);
    return;
  }
  if (state.resumeState.profileError) {
    qs("#resumeStatus").textContent = `${state.resumeState.profileError} 已保留本地提取结果，点击“匹配”可重试。`;
    return;
  }
  const profile = reusableResumeProfile(resume);
  if (profile) {
    status.textContent = "";
    status.classList.add("is-hidden");
    return;
  }
  qs("#resumeStatus").textContent = `已提取：${label}，共 ${length} 字。匹配前会自动完成简历理解。`;
}

function markResumeReady(state, label, callbacks) {
  state.resumeState.uploaded = true;
  qs("#resumeStatus").textContent = parsedResumeStatus(label, state.resumeState.data);
  callbacks.updateMatchState();
  callbacks.setStep("match");
}

function parsedResumeStatus(label, resume) {
  const length = String(resume && resume.rawText || "").length;
  const suffix = length ? `共提取 ${length} 字，` : "";
  return `已解析：${label}。${suffix}将检查是否为有效简历。`;
}

function renderEmptyResume() {
  const status = qs("#resumeStatus");
  status.classList.remove("error");
  status.textContent = EMPTY_RESUME_MESSAGE;
}
