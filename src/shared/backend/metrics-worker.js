/**
 * 后台匿名统计队列：串行创建安装 ID、校验并持久化事件、去重及批量补发。
 * 限制事件年龄和队列容量；不可恢复批次移除，临时失败保留待重发。
 */
import { backendUrl, USAGE_MODULES } from "./config.js";
import { SETTINGS_KEY } from "../config/constants.js";
const ID_KEY = "rolemi.installationId";
const QUEUE_KEY = "rolemi.usageQueue";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let serial = Promise.resolve();
let flushing;

function settingsMode(settings) {
  if (settings?.mode === "hosted" || settings?.mode === "custom") return settings.mode;
  return settings?.provider && settings.provider !== "hosted" ? "custom" : "hosted";
}

async function currentMode() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return settingsMode(data[SETTINGS_KEY]);
}

// storage.local 没有跨异步步骤的事务能力；所有读改写都进入同一条 Promise 链，
// 避免并发创建 installationId、入队和出队时互相覆盖。
function locked(action) {
  const result = serial.then(action);
  serial = result.catch(() => {});
  return result;
}
async function installation() {
  const data = await chrome.storage.local.get(ID_KEY);
  if (UUID.test(data[ID_KEY] || "")) return data[ID_KEY];
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [ID_KEY]: id });
  return id;
}
export function installationId() { return locked(installation); }
export function enqueueUsage(payload) {
  return locked(async () => {
    if (!payload || Object.keys(payload).sort().join() !== "date,event,execution_id,module" ||
        !USAGE_MODULES.includes(payload.module) || !UUID.test(payload.execution_id) ||
        !["start", "success", "failed"].includes(payload.event) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) return;
    const age = Date.now() - Date.parse(payload.date);
    if (!Number.isFinite(age) || age < -86400000 || age > 7 * 86400000) return;
    const installation_id = await installation();
    const data = await chrome.storage.local.get(QUEUE_KEY);
    const queue = (data[QUEUE_KEY] || []).filter(item => Date.now() - Date.parse(item.date) < 7 * 86400000);
    if (!queue.some(item => item.execution_id === payload.execution_id && item.event === payload.event)) {
      const existing = queue.find(item => item.execution_id === payload.execution_id && ["hosted", "custom"].includes(item.mode));
      const mode = existing?.mode || await currentMode();
      queue.push({ installation_id, module: payload.module, mode, execution_id: payload.execution_id, event: payload.event, date: payload.date });
    }
    await chrome.storage.local.set({ [QUEUE_KEY]: queue.slice(-200) });
  });
}
export function flushUsage() {
  // 多个触发源（启动、消息、alarm）可能同时要求补发；共享同一个 Promise，
  // 确保同一批事件不会被并发发送。finally 后才允许下一轮补发。
  if (flushing) return flushing;
  flushing = (async () => {
    const batch = await locked(async () => {
      const data = await chrome.storage.local.get(QUEUE_KEY);
      const fallbackMode = await currentMode();
      return (data[QUEUE_KEY] || [])
        .filter(item => Date.now() - Date.parse(item.date) < 7 * 86400000)
        .slice(0, 40)
        .map(item => ({ ...item, mode: ["hosted", "custom"].includes(item.mode) ? item.mode : fallbackMode }));
    });
    if (!batch.length) return;
    const response = await fetch(backendUrl("/api/events"), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }), signal: AbortSignal.timeout(8000)
    });
    // 400/413 表示该批次不可恢复，移除以免永久堵住队列；其他失败保留等待重试。
    if (!response.ok && ![400, 413].includes(response.status)) return;
    await locked(async () => {
      const data = await chrome.storage.local.get(QUEUE_KEY);
      const sent = new Set(batch.map(item => `${item.execution_id}:${item.event}`));
      await chrome.storage.local.set({ [QUEUE_KEY]: (data[QUEUE_KEY] || []).filter(item => !sent.has(`${item.execution_id}:${item.event}`)) });
    });
  })().catch(() => {}).finally(() => { flushing = null; });
  return flushing;
}
