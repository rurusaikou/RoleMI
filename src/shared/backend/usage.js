/**
 * 业务使用事件 API：生成执行 UUID，发送 start，并至多结算一次 success / failed。
 * 缓存计数须由调用方显式触发；上报失败不阻断业务，不接收业务正文。
 */
import { USAGE_MODULES } from "./config.js";

export async function getInstallationId() {
  if (!globalThis.chrome?.runtime?.id) throw new Error("请在 RoleMI 扩展中使用托管服务。");
  const result = await chrome.runtime.sendMessage({ type: "rolemi.installation" });
  if (!result?.installation_id) throw new Error("无法初始化 RoleMI 服务，请重新打开插件。");
  return result.installation_id;
}

// 一次执行跨内部重试共用标识。只接受白名单枚举，不接收业务对象或错误详情。
export function startUsage(module) {
  if (!USAGE_MODULES.includes(module)) throw new Error("Unknown usage module");
  const execution_id = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  let finished = false;
  const send = (event) => {
    if (!globalThis.chrome?.runtime?.id) return;
    try {
      Promise.resolve(chrome.runtime.sendMessage({ type: "rolemi.usage", payload: { module, execution_id, event, date } })).catch(() => {});
    } catch { /* 上报不得影响业务。 */ }
  };
  send("start");
  return (success) => {
    if (finished) return;
    finished = true;
    send(success ? "success" : "failed");
  };
}

export async function trackUsage(module, action) {
  const finish = startUsage(module);
  try {
    const result = await action();
    finish(true);
    return result;
  } catch (error) {
    finish(false);
    throw error;
  }
}
export function cachedUsage(module) { startUsage(module)(true); }
