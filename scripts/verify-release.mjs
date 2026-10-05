import fs from "node:fs";
import path from "node:path";
const root = process.cwd();
const dist = path.join(root, "dist/store");
const failures = [];
if (!fs.existsSync(dist)) failures.push("dist/store does not exist; run build:store first");
else {
  const manifest = JSON.parse(fs.readFileSync(path.join(dist, "manifest.json"), "utf8"));
  if (manifest.version !== "3.0.0") failures.push("manifest version is not 3.0.0");
  if (manifest.content_scripts) failures.push("store manifest must not contain persistent content_scripts");
  if ((manifest.host_permissions || []).some(x => x.includes("<all_urls>") || x.includes("localhost"))) failures.push("store host_permissions contains broad/local development access");
  const cfg = fs.readFileSync(path.join(dist, "src/shared/backend/config.js"), "utf8");
  if (cfg.includes("http://localhost:8787")) failures.push("store backend still points to localhost");
  if (!/export const BACKEND_URL = "https:\/\//.test(cfg)) failures.push("store backend is not HTTPS");
}
if (failures.length) { console.error(failures.map(x => `FAIL: ${x}`).join("\n")); process.exit(1); }
console.log("Release verification passed.");
