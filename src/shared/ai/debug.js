/**
 * 本地 AI 调试与可靠性计数：提供日志开关、耗时记录和深度分析重试统计。
 * 不打印业务正文；本地计数与远端匿名使用事件是两条独立链路。
 */
const DEBUG_API_STORAGE_KEY = "rolemi.debugApi";
const RELIABILITY_STORAGE_KEY = "rolemi.deepAnalysisReliability";

installDebugApiControls();

// 调试日志同样不记录业务正文、URL、原始错误或模型输出。
export function logApiRequest(label, { url, body }) {
  if (!isApiDebugEnabled()) return;
  console.groupCollapsed(`[RoleMI API request] ${label}`);
  console.log("request", { max_output_tokens: body?.max_output_tokens });
  console.groupEnd();
}

export function logApiResponse(label, payload) {
  if (!isApiDebugEnabled()) return;
  console.groupCollapsed(`[RoleMI API response] ${label}`);
  console.log({ status: ["completed", "incomplete", "failed"].includes(payload?.status) ? payload.status : "unknown" });
  console.groupEnd();
}

export function logApiTiming(label, elapsedMs) {
  if (!isApiDebugEnabled()) return;
  console.info(`[RoleMI API timing] ${label}: ${Math.round(Number(elapsedMs) || 0)} ms`);
}

export function logApiError(label, errorPayload) {
  if (!isApiDebugEnabled()) return;
  console.groupCollapsed(`[RoleMI API error] ${label}`);
  console.log({ status: Number(errorPayload?.status) || 0 });
  console.groupEnd();
}

/**
 * Deep Analysis 可靠性计数。
 * 只保存计数和时间，不保存 JD、简历、Prompt 或模型响应。
 *
 * firstAttempt：通过输入和配置校验、进入首次模型尝试时 +1（包括自动前置）
 * retry：第一次因输出截断 / JSON 不完整而自动重试时 +1
 * finalFailure：首次遇到不可重试错误，或自动重试后仍失败时 +1
 */
export function recordDeepAnalysisReliability(event) {
  if (!["firstAttempt", "retry", "finalFailure"].includes(event)) return;
  const stats = readReliabilityStats();
  stats[event] += 1;
  stats.updatedAt = new Date().toISOString();
  writeReliabilityStats(stats);
  if (isApiDebugEnabled()) {
    console.info(`[RoleMI reliability] deep-analysis ${event}`, cloneForLog(stats));
  }
}

/** 记录某次 Deep Analysis attempt 的技术失败原因；仅 Debug 开启时输出。 */
export function logDeepAnalysisAttemptFailure(attempt, error, details = {}) {
  if (!isApiDebugEnabled()) return;
  console.groupCollapsed(`[RoleMI reliability] deep-analysis ${attempt} failed`);
  console.log("code", error?.code || error?.name || "unknown");
  console.log("reason", ["max_output_tokens", "incomplete_json", "empty_output"].includes(error?.reason) ? error.reason : "unknown");
  console.log("inputChars", Number(details.inputChars) || 0);
  console.groupEnd();
}

export function getDeepAnalysisReliabilityStats() {
  return readReliabilityStats();
}

export function resetDeepAnalysisReliabilityStats() {
  const stats = emptyReliabilityStats();
  writeReliabilityStats(stats);
  return stats;
}

function installDebugApiControls() {
  if (typeof window === "undefined" || window.ROLEMI_DEBUG_API) return;
  window.ROLEMI_DEBUG_API = {
    enable() {
      window.localStorage.setItem(DEBUG_API_STORAGE_KEY, "true");
      console.info("[RoleMI API debug] enabled");
    },
    disable() {
      window.localStorage.removeItem(DEBUG_API_STORAGE_KEY);
      console.info("[RoleMI API debug] disabled");
    },
    status() {
      const enabled = isApiDebugEnabled();
      console.info(`[RoleMI API debug] ${enabled ? "enabled" : "disabled"}`);
      return enabled;
    },
    stats() {
      const stats = getDeepAnalysisReliabilityStats();
      console.table(stats);
      return stats;
    },
    resetStats() {
      const stats = resetDeepAnalysisReliabilityStats();
      console.info("[RoleMI reliability] deep-analysis stats reset");
      return stats;
    }
  };
  console.info("[RoleMI API debug] run ROLEMI_DEBUG_API.enable() to log API requests and responses.");
}

function isApiDebugEnabled() {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(DEBUG_API_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

function emptyReliabilityStats() {
  return { firstAttempt: 0, retry: 0, finalFailure: 0, updatedAt: null };
}

function readReliabilityStats() {
  try {
    if (typeof window === "undefined") return emptyReliabilityStats();
    const parsed = JSON.parse(window.localStorage.getItem(RELIABILITY_STORAGE_KEY) || "null");
    return {
      firstAttempt: Number(parsed?.firstAttempt) || 0,
      retry: Number(parsed?.retry) || 0,
      finalFailure: Number(parsed?.finalFailure) || 0,
      updatedAt: parsed?.updatedAt || null
    };
  } catch (_error) {
    return emptyReliabilityStats();
  }
}

function writeReliabilityStats(stats) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RELIABILITY_STORAGE_KEY, JSON.stringify(stats));
    }
  } catch (_error) {
    // 统计失败不能影响正常业务请求。
  }
}

function cloneForLog(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return value;
  }
}
