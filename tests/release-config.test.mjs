import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
const html = fs.readFileSync(new URL("../src/popup.html", import.meta.url), "utf8");

test("release source manifest uses on-demand extraction instead of broad persistent page access", () => {
  assert.equal(manifest.content_scripts, undefined);
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
  assert.deepEqual(manifest.host_permissions, [
    "http://localhost:8787/*",
    "*://*.zhipin.com/*",
    "*://*.zhaopin.com/*",
    "*://*.liepin.com/*"
  ]);
  for (const permission of ["activeTab", "scripting", "storage", "sidePanel", "downloads", "alarms"]) {
    assert.ok(manifest.permissions.includes(permission));
  }
});

test("feedback disclosure explains uploaded workflow data and excludes raw resume attachments", () => {
  assert.match(html, /提交反馈会发送你的反馈内容/);
  assert.match(html, /岗位描述及已生成的 AI 分析结果/);
  assert.match(html, /不会发送简历原文或附件/);
});
