/**
 * 手动 JD 录入规则：校验正文长度与非空内容，构造待保存岗位。
 * 选填字段只做文本整理，不调用模型补全。
 */
export const MANUAL_JD_MAX_LENGTH = 2000;

// sourceUrl 为空是必要条件，避免把曾被错误标记来源的网页岗位开放给手动编辑。
export function isManualJob(job) {
  return job?.sourceSite === "手动添加" && !job?.sourceUrl;
}

export function createManualJob(fields) {
  const description = String(fields.description || "").trim();
  if (!description) throw new Error("请粘贴岗位描述");
  if (String(fields.description || "").length > MANUAL_JD_MAX_LENGTH) throw new Error("岗位描述不能超过 2000 字");
  return {
    title: String(fields.title || "").trim(),
    company: String(fields.company || "").trim(),
    experience: String(fields.experience || "").trim(),
    salary: String(fields.salary || "").trim(),
    description,
    sourceSite: "手动添加",
    sourceUrl: ""
  };
}

/** 用现有表单字段原位更新手动岗位，保留 ID、收藏和全部派生结果。 */
export function updateManualJob(job, fields) {
  if (!isManualJob(job)) throw new Error("只有手动添加的岗位可以编辑");
  return { ...job, ...createManualJob(fields), id: job.id };
}

export function analysisInputChanged(before, after) {
  // 只比较会进入岗位分析的事实字段；收藏、来源等展示状态不应让 AI 结果失效。
  const fields = ["title", "company", "location", "experience", "education", "salary", "description"];
  const normalized = (value) => String(value || "").replace(/\r\n?/g, "\n").trim();
  return fields.some((field) => normalized(before?.[field]) !== normalized(after?.[field]));
}
