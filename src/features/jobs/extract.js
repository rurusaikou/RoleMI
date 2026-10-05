/**
 * 当前标签页 JD 提取入口：先检查协议与招聘站点域名，再发送提取消息。
 * 需要时注入内容脚本，页面 DOM 解析由 content.js 完成。
 */
import { chromeAsync } from "../../shared/storage/chrome-storage.js";

const UNSUPPORTED_PAGE_MESSAGE = "当前网址不支持提取岗位，仅支持 BOSS 直聘、智联招聘和猎聘的职位详情页。其他渠道请使用「手动添加岗位」。";
const UNREADABLE_PAGE_MESSAGE = "暂时无法读取当前网页，请刷新招聘页面并重新打开 RoleMI 后再试。";

export function isSupportedExtractionUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && /(^|\.)(zhipin|zhaopin|liepin)\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

export async function extractFromCurrentTab() {
  if (!(window.chrome && chrome.tabs && chrome.scripting)) {
    throw new Error("请在浏览器扩展侧边栏中使用提取功能");
  }

  const tab = await activeTab();
  if (!tab || !tab.id) throw new Error("没有找到当前标签页");
  const currentUrl = await resolveTabUrl(tab);
  if (!currentUrl) throw new Error(UNREADABLE_PAGE_MESSAGE);
  // 浏览器内部页面不能注入脚本，必须在发送消息和注入之前拦截。
  if (!isSupportedExtractionUrl(currentUrl)) {
    throw new Error(UNSUPPORTED_PAGE_MESSAGE);
  }

  const response = await sendMessageWithInjection(tab.id, { type: "ROLEMI_EXTRACT" });
  if (!response || !response.ok) throw new Error((response && response.message) || "页面没有返回岗位信息");
  return response.job;
}

async function activeTab() {
  const tabs = await chromeAsync((done) => chrome.tabs.query({ active: true, currentWindow: true }, done));
  return tabs[0];
}

async function resolveTabUrl(tab) {
  if (tab.pendingUrl || tab.url) return tab.pendingUrl || tab.url;

  // Edge 侧边栏偶尔只返回标签 ID，即使清单已具备当前站点权限。
  // 此时让浏览器权限系统先约束脚本执行范围，只读取 location.href，再走同一域名白名单校验。
  try {
    const results = await chromeAsync((done) => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => location.href
      }, done);
    });
    return results?.[0]?.result || "";
  } catch (_error) {
    return "";
  }
}

async function sendMessageWithInjection(tabId, message) {
  let response;

  try {
    response = await sendMessage(tabId, message);
  } catch (_error) {
    await chromeAsync((done) => {
      chrome.scripting.executeScript({ target: { tabId }, files: ["src/content.js"] }, done);
    });
    response = await sendMessage(tabId, message);
  }

  return response;
}

function sendMessage(tabId, message) {
  return chromeAsync((done) => {
    chrome.tabs.sendMessage(tabId, message, done);
  });
}
