/**
 * 托管服务配置：集中后端地址、使用事件白名单和 AI 请求模块映射。
 * 校验服务地址协议，区分业务使用模块与连接测试模块。
 */
// 发布者统一替换为已部署的 HTTPS Worker 地址，普通用户无需配置。
export const BACKEND_URL = "http://localhost:8787";
export const USAGE_MODULES = Object.freeze([
  "jd_extract", "jd_manual", "favorite", "resume_import", "deep_analysis",
  "resume_profile", "resume_match", "resume_revision", "greeting", "excel_export"
]);
export const AI_MODULES = Object.freeze({
  "deep-analysis": "deep_analysis", "resume-profile": "resume_profile",
  "resume-match": "resume_match", "resume-revisions": "resume_revision", greeting: "greeting",
  "settings-test": "settings_test"
});
export function backendUrl(path) {
  const url = new URL(BACKEND_URL);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("RoleMI 服务地址配置无效，请联系维护者。");
  }
  return `${url.href.replace(/\/$/, "")}${path}`;
}
