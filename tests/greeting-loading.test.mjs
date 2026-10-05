import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("开场白生成态展示轮播主题并兼容减少动态效果", async () => {
  const [html, css, controller] = await Promise.all([
    readFile(new URL("src/popup.html", root), "utf8"),
    readFile(new URL("src/popup.css", root), "utf8"),
    readFile(new URL("src/app/controllers/greeting-controller.js", root), "utf8")
  ]);

  for (const text of ["岗位最关注的能力", "最有说服力的经历", "表达与事实边界", "自然的沟通开场"]) assert.ok(html.includes(text));
  assert.match(html, /id="greetingLoading"[\s\S]*?role="status"/);
  assert.match(controller, /#greetingLoading[\s\S]*?classList\.toggle\("is-hidden", !isLoading\)/);
  assert.match(controller, /textArea\.classList\.toggle\("is-hidden", isLoading\)/);
  assert.match(css, /@keyframes greeting-topic/);
  assert.match(css, /prefers-reduced-motion:[\s\S]*?greeting-topic-carousel/);
});
