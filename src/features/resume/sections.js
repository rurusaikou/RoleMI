/**
 * 本地简历章节识别：维护章节别名并按标题拆分文本，供辅助结构提取使用。
 */
import { compactLine } from "./normalize.js";

export const SECTION_RULES = [
  { key: "basicInfo", names: ["个人信息", "基本信息", "联系方式"] },
  { key: "jobIntent", names: ["求职意向", "应聘岗位", "目标岗位", "求职目标"] },
  { key: "education", names: ["教育经历", "教育背景", "学习经历", "教育情况"] },
  { key: "workExperience", names: ["工作经历", "工作经验", "实习经历", "任职经历", "职业经历"] },
  { key: "projects", names: ["项目经历", "项目经验", "实践经历", "案例经历"] },
  { key: "skills", names: ["专业技能", "技能特长", "核心能力", "个人能力", "语言能力", "工具能力"] },
  { key: "certifications", names: ["证书", "资格证书", "荣誉奖项", "获奖经历", "荣誉证书"] },
  { key: "selfEvaluation", names: ["自我评价", "个人评价", "个人总结", "职业总结", "自我介绍"] }
];

export function splitResumeSections(text) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const sections = [];
  let current = { key: "unknown", title: "未分类", lines: [] };

  // 简历结构最稳定的信号通常是章节标题；先切骨架，再做字段级解析。
  for (const line of lines) {
    const matched = matchSectionTitle(line);
    if (matched) {
      if (current.lines.length) sections.push(current);
      current = { key: matched.key, title: matched.title, lines: [] };
      if (matched.remainder) current.lines.push(matched.remainder);
      continue;
    }

    current.lines.push(line);
  }

  if (current.lines.length) sections.push(current);
  return sections;
}

export function sectionText(sections, key) {
  return sections.filter((section) => section.key === key).flatMap((section) => section.lines).join("\n");
}

function matchSectionTitle(line) {
  const normalized = compactLine(line).replace(/^[-—_*#]+|[-—_*#]+$/g, "");
  if (!normalized) return null;

  for (const rule of SECTION_RULES) {
    const title = rule.names.find((name) => normalized === name || normalized === `${name}经历` || normalized.startsWith(`${name}：`) || normalized.startsWith(`${name}:`) || normalized.startsWith(`${name}｜`));
    if (title) {
      return { key: rule.key, title, remainder: normalized.slice(title.length).replace(/^[:：｜]/, "").trim() };
    }
  }

  return null;
}
