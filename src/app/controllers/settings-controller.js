/** 服务设置的保存、默认服务恢复和自定义 Responses API 连接测试。 */
import { restoreDefaultSettings, saveSettings, testApiKey } from "../../features/settings/service.js";
import { qs } from "../../shared/ui/dom.js";

export function bindSettingsEvents() {
  let settingsBusy = false;
  const controls = ["#testApiBtn", "#saveSettingsBtn", "#restoreDefaultServiceBtn", "#baseUrl", "#modelName", "#apiKey"];
  const setBusy = (busy, activeButton) => {
    settingsBusy = busy;
    controls.forEach((selector) => { qs(selector).disabled = busy; });
    for (const selector of ["#testApiBtn", "#saveSettingsBtn", "#restoreDefaultServiceBtn"]) {
      qs(selector).removeAttribute("aria-busy");
    }
    if (busy && activeButton) activeButton.setAttribute("aria-busy", "true");
  };

  qs("#testApiBtn").addEventListener("click", async (event) => {
    if (settingsBusy) return;
    setBusy(true, event.currentTarget);
    try {
      await testApiKey();
    } finally {
      setBusy(false);
    }
  });
  qs("#restoreDefaultServiceBtn").addEventListener("click", async (event) => {
    if (settingsBusy) return;
    const button = event.currentTarget;
    const status = qs("#apiStatus");
    setBusy(true, button);
    try {
      await restoreDefaultSettings();
      status.className = "api-status ok";
      status.textContent = "已恢复使用 RoleMI 默认服务。";
    } catch (error) {
      status.className = "api-status error";
      status.textContent = error.message || "恢复失败，请重试。";
    } finally {
      setBusy(false);
    }
  });
  qs("#apiForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = qs("#saveSettingsBtn");
    const status = qs("#apiStatus");
    if (settingsBusy) return;
    setBusy(true, button);
    button.textContent = "保存中…";
    try {
      const settings = await saveSettings();
      qs("#currentServiceStatus").textContent = settings.mode === "hosted"
        ? "当前使用默认服务"
        : "当前使用自定义服务";
      status.className = "api-status ok";
      status.textContent = settings.mode === "hosted" ? "已恢复使用 RoleMI 服务。" : "已保存，将使用你的 Responses API。";
    } catch (error) {
      status.className = "api-status error";
      status.textContent = error.message || "保存失败，请重试。";
    } finally {
      button.textContent = "保存设置";
      setBusy(false);
    }
  });
}
