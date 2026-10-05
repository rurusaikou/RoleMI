/**
 * 手动 JD 录入规则：校验正文长度与非空内容，构造待保存岗位。
 * 选填字段只做文本整理，不调用模型补全。
 */
export const MANUAL_JD_MAX_LENGTH = 2000;

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
