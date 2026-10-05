/**
 * 本地简历转提示文本的辅助工具：优先保留全文，附加规则结构作为索引。
 * 当前匹配流程使用结构化事实，不以此工具回退简历原文。
 */
export function resumeToPromptText(resume) {
  const rawText = String(resume && resume.rawText || "").trim();
  const structuredText = structuredResumeText(resume);
  const parts = [];

  // 模型判断必须优先看到完整原文；规则结构化可能漏章节，只作为辅助索引。
  if (rawText) {
    parts.push([
      "简历全文（PDF / DOCX 本地提取原文，优先依据）：",
      rawText
    ].join("\n"));
  }

  if (structuredText) {
    parts.push([
      "结构化识别结果（仅辅助，可能不完整）：",
      structuredText
    ].join("\n"));
  }

  return parts.join("\n\n") || structuredText || rawText;
}

function structuredResumeText(resume) {
  if (!resume) return "";

  const basic = resume.basicInfo || {};
  const linesForPrompt = [];
  appendValue(linesForPrompt, "姓名", basic.name);
  appendValue(linesForPrompt, "求职意向", basic.jobIntent);
  appendValue(linesForPrompt, "所在地", basic.location);
  appendValue(linesForPrompt, "手机", basic.phone);
  appendValue(linesForPrompt, "邮箱", basic.email);
  appendSection(linesForPrompt, "教育经历", resume.education, (item) => [
    [item.startDate, item.endDate].filter(Boolean).join("-"),
    item.school,
    item.degree,
    item.major,
    lines(item.description).join("；")
  ].filter(Boolean).join(" "));
  appendSection(linesForPrompt, "工作经历", resume.workExperience, (item) => [
    [item.startDate, item.endDate].filter(Boolean).join("-"),
    item.organization,
    item.role,
    lines(item.description).join("；")
  ].filter(Boolean).join(" "));
  appendSection(linesForPrompt, "项目经历", resume.projects, (item) => [
    [item.startDate, item.endDate].filter(Boolean).join("-"),
    item.name,
    item.role,
    lines(item.description).join("；")
  ].filter(Boolean).join(" "));
  appendList(linesForPrompt, "技能 / 能力", resume.skills);
  appendList(linesForPrompt, "证书 / 荣誉", resume.certifications);
  appendValue(linesForPrompt, "自我评价", resume.selfEvaluation);
  appendUnclassifiedSections(linesForPrompt, resume.sections);
  return linesForPrompt.join("\n");
}

function appendValue(target, label, value) {
  if (value) target.push(`${label}：${value}`);
}

function appendSection(target, title, entries, renderEntry) {
  const rows = (entries || []).map(renderEntry).filter(Boolean);
  if (!rows.length) return;
  target.push(`${title}：`, ...rows.map((row) => `- ${row}`));
}

function appendList(target, title, items) {
  if (items && items.length) target.push(`${title}：${items.join("、")}`);
}

function appendUnclassifiedSections(target, sections) {
  const rows = (sections || [])
    .filter((section) => section && section.key === "unknown" && section.lines && section.lines.length)
    .flatMap((section) => section.lines);
  if (rows.length) target.push("未分类内容：", ...rows.map((row) => `- ${row}`));
}

function lines(value) {
  return Array.isArray(value) ? value : [value].filter(Boolean);
}
