import test from "node:test";
import assert from "node:assert/strict";
import { exportFilename, jobRows } from "../src/features/jobs/export.js";
import { legacyJob } from "./helpers.mjs";

test("全部岗位与收藏岗位使用不同的导出文件名", () => {
  assert.equal(exportFilename("全部岗位", "2026-10-04"), "RoleMI-全部岗位-2026-10-04.xlsx");
  assert.equal(exportFilename("收藏岗位", "2026-10-04"), "RoleMI-收藏岗位-2026-10-04.xlsx");
  assert.equal(exportFilename("未知范围", "2026-10-04"), "RoleMI-全部岗位-2026-10-04.xlsx");
});


test("导出把岗位唯一标识作为单独一列", () => {
  const [row] = jobRows([{ ...legacyJob, id: "job_abc" }]);
  assert.equal(row["唯一标识"], "job_abc");
  assert.equal(Object.keys(row)[0], "唯一标识");
});
test("导出包含公司行业、融资阶段和规模", () => {
  const [row] = jobRows([{
    ...legacyJob,
    companyIndustry: "通信/网络设备",
    companyStage: "未融资",
    companyScale: "10000人以上"
  }]);
  assert.equal(row["行业"], "通信/网络设备");
  assert.equal(row["融资阶段"], "未融资");
  assert.equal(row["公司规模"], "10000人以上");
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
