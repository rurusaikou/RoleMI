/**
 * 本地简历辅助结构提取：保留规范化全文并按章节与日期生成基础索引。
 * 规则识别可能漏掉非标准章节，不作为 AI 匹配的最终事实来源。
 */
import { normalizeResumeText } from "./normalize.js";
import { sectionText, splitResumeSections } from "./sections.js";

const DATE_RANGE_RE = /((?:19|20)\d{2}(?:[./年-]\d{1,2})?)\s*(?:-|~|—|–|至|到)\s*((?:19|20)\d{2}(?:[./年-]\d{1,2})?|至今|现在|目前)/;

export function structureResumeText(text, source) {
  const rawText = normalizeResumeText(text);
  if (!rawText) throw new Error("简历文本为空，可能是扫描版 PDF 或文件内容不可解析。");

  const sections = splitResumeSections(rawText);
  // 这里保持行业无关：只识别通用章节、联系方式、时间段和条目，不维护 IT 技能词表。
  return {
    source: {
      fileName: source.fileName || "",
      fileType: source.fileType || "",
      parsedAt: new Date().toISOString()
    },
    basicInfo: extractBasicInfo(rawText, sections),
    education: extractEntries(sectionText(sections, "education"), "education"),
    workExperience: extractEntries(sectionText(sections, "workExperience"), "work"),
    projects: extractEntries(sectionText(sections, "projects"), "project"),
    skills: extractList(sectionText(sections, "skills")),
    certifications: extractList(sectionText(sections, "certifications")),
    selfEvaluation: sectionText(sections, "selfEvaluation"),
    sections,
    rawText
  };
}

function extractBasicInfo(text, sections) {
  const headText = [
    sectionText(sections, "basicInfo"),
    sectionText(sections, "jobIntent"),
    text.split("\n").slice(0, 10).join("\n")
  ].filter(Boolean).join("\n");

  return {
    name: inferName(text),
    phone: firstMatch(text, /(?:\+?86[-\s]?)?1[3-9]\d{9}/),
    email: firstMatch(text, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i),
    location: labeledValue(headText, /(?:所在地|现居|地址|城市)[:：]?\s*([^\n｜|,，;；]+)/),
    jobIntent: labeledValue(headText, /(?:求职意向|应聘岗位|目标岗位|求职目标)[:：]?\s*([^\n｜|,，;；]+)/)
  };
}

function extractEntries(text, type) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];

  const entries = [];
  let current = null;

  for (const line of lines) {
    const dateMatch = line.match(DATE_RANGE_RE);
    if (dateMatch) {
      if (current) entries.push(current);
      current = entryFromHeader(line, dateMatch, type);
      continue;
    }

    if (!current) current = emptyEntry(type);
    // 日期单独占一行时，下一行通常才是学校/公司/项目及角色。
    if (entryHeaderIsEmpty(current, type) && !looksLikeBullet(line)) {
      fillEntryHeader(current, line, type);
      continue;
    }
    current.description.push(cleanBullet(line));
  }

  if (current) entries.push(current);
  return entries.map((entry) => ({
    ...entry,
    description: entry.description.filter(Boolean),
    achievements: entry.description.filter(hasResultSignal)
  }));
}

function entryFromHeader(line, dateMatch, type) {
  const entry = emptyEntry(type);
  entry.startDate = dateMatch[1];
  entry.endDate = dateMatch[2];

  const rest = line.replace(dateMatch[0], "").replace(/^\s*[|｜]\s*/, "").trim();
  fillEntryHeader(entry, rest, type);

  return entry;
}

function fillEntryHeader(entry, text, type) {
  const rest = String(text || "").replace(/[|]/g, "｜").trim();
  let parts = rest.split(/\s*｜\s*|[，,]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    const tokens = rest.split(/\s+/).filter(Boolean);
    if (type === "education" && tokens.length > 1) parts = educationParts(tokens);
    if (type !== "education" && tokens.length > 1 && looksLikeRole(tokens.at(-1))) {
      parts = [tokens.slice(0, -1).join(" "), tokens.at(-1)];
    }
  }

  if (type === "education") {
    const degree = inferDegree(rest);
    entry.school = parts[0] || rest.replace(degree, "").trim();
    entry.major = parts[1] || "";
    entry.degree = parts.find((part) => inferDegree(part)) || degree;
  } else if (type === "project") {
    entry.name = parts[0] || rest;
    entry.role = parts[1] || "";
  } else {
    entry.organization = parts[0] || rest;
    entry.role = parts[1] || "";
  }
}

function educationParts(tokens) {
  const degreeIndex = tokens.findIndex((token) => inferDegree(token));
  if (degreeIndex < 0) return tokens.length >= 2 ? [tokens[0], tokens.slice(1).join(" ")] : tokens;
  return [tokens[0], tokens.slice(1, degreeIndex).join(" "), tokens[degreeIndex]].filter(Boolean);
}

function looksLikeRole(value) {
  return /经理|负责人|主管|总监|工程师|设计师|顾问|研究员|分析师|运营|开发|产品|实习|助理|专员|leader|manager|engineer|designer/i.test(value);
}

function entryHeaderIsEmpty(entry, type) {
  if (type === "education") return !entry.school && !entry.major && !entry.degree;
  if (type === "project") return !entry.name && !entry.role;
  return !entry.organization && !entry.role;
}

function looksLikeBullet(line) {
  return /^\s*(?:[-*•·]|\d+[.)、])\s*/.test(line) || /[。；;]$/.test(line) || line.length > 80;
}

function emptyEntry(type) {
  if (type === "education") {
    return { school: "", degree: "", major: "", startDate: "", endDate: "", description: [], achievements: [] };
  }
  if (type === "project") {
    return { name: "", role: "", startDate: "", endDate: "", description: [], achievements: [] };
  }
  return { organization: "", role: "", startDate: "", endDate: "", description: [], achievements: [] };
}

// 结构化列表只保留短条目并限制数量；rawText 仍保留全文供模型补充判断。
function extractList(text) {
  return String(text || "")
    .split(/\n|[、,，;；]/)
    .map(cleanBullet)
    .filter((item) => item && item.length <= 80)
    .slice(0, 40);
}

function inferName(text) {
  const blocked = /简历|个人|信息|电话|邮箱|手机|求职|应聘|岗位|教育|工作|项目|经历|技能/;
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 8);
  const line = lines.find((item) => {
    const clean = item.replace(/\s+/g, "");
    return !blocked.test(clean) && (/^[\u4e00-\u9fa5]{2,4}$/.test(clean) || /^[A-Za-z]+(?:\s+[A-Za-z]+){1,3}$/.test(item));
  });
  return line || "";
}

function firstMatch(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[0] : "";
}

function labeledValue(text, pattern) {
  const match = String(text || "").match(pattern);
  return match ? match[1].trim() : "";
}

function inferDegree(text) {
  return firstMatch(text, /博士|硕士|研究生|本科|大专|专科|高中|中专/);
}

function cleanBullet(line) {
  return String(line || "").replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/, "").trim();
}

function hasResultSignal(line) {
  return /(\d+%?|\d+万|\d+家|\d+人|\d+个月|提升|降低|完成|负责|推动|获得|达成|优化|建立|管理|交付)/.test(line);
}
