import test from "node:test";
import assert from "node:assert/strict";
import { exportFilename, jobRows } from "../src/features/jobs/export.js";
import { legacyJob } from "./helpers.mjs";

test("全部岗位与收藏岗位使用不同的导出文件名", () => {
  assert.equal(exportFilename("全部岗位", "2026-10-04"), "RoleMI-全部岗位-2026-10-04.xlsx");
  assert.equal(exportFilename("收藏岗位", "2026-10-04"), "RoleMI-收藏岗位-2026-10-04.xlsx");
  assert.equal(exportFilename("未知范围", "2026-10-04"), "RoleMI-全部岗位-2026-10-04.xlsx");
});

test("用户导出的岗位字段不包含 Token 或内部用量", () => {
  const [row] = jobRows([{
    ...legacyJob,
    deepAnalysis: { usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } },
    resumeMatch: { result: { usage: { totalTokens: 40 } } },
    greeting: { result: { greeting: "您好", usage: { totalTokens: 50 } } }
  }]);
  const columns = Object.keys(row);

  assert.equal(columns.some((column) => /token|用量/i.test(column)), false);
  assert.equal(columns.at(-1), "求职开场白");
});
