/**
 * 扩展后台入口：配置工具栏打开侧栏，接收匿名安装及使用事件消息。
 * 校验消息来源后交给持久化队列，并在启动、入队和定时闹钟时尝试上报。
 */
import { enqueueUsage, flushUsage, installationId } from "./shared/backend/metrics-worker.js";
function enableSidePanelOnActionClick() {
  // 让用户点击浏览器工具栏里的 RoleMI 图标时打开侧边栏面板。
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
}

chrome.runtime.onInstalled.addListener(enableSidePanelOnActionClick);
chrome.runtime.onStartup.addListener(enableSidePanelOnActionClick);

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === "rolemi.installation") {
    installationId().then(installation_id => reply({ installation_id })).catch(() => reply({ error: true }));
    return true;
  }
  if (message?.type === "rolemi.usage") {
    enqueueUsage(message.payload).then(() => { reply({ ok: true }); void flushUsage(); }).catch(() => reply({ ok: false }));
    return true;
  }
});
chrome.alarms.create("rolemi.usage.flush", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "rolemi.usage.flush") void flushUsage(); });
void flushUsage();
