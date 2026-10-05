/**
 * 派生摘要构建与复用：按内容及分析版本生成岗位和简历摘要，保留关键事实。
 */
import { normalizeHiddenRequirements } from "./hidden-requirements.js";
import { SUMMARY_VERSION, reusableAnalysis } from "./cache.js";

const strings = (items) => Array.isArray(items) ? items.filter((item) => typeof item === "string" && item.trim()) : [];

export function getJobSummary(job) {
  const summary = job.summary;
  return summary?.version === SUMMARY_VERSION && summary.sourceVersion === job.contentVersion &&
    summary.analysisResultId === (reusableAnalysis(job)?.resultId || "") ? summary : buildJobSummary(job);
}

export function getResumeSummary(resume) {
  const summary = resume.summary;
  return summary?.version === SUMMARY_VERSION && summary.sourceVersion === resume.contentVersion ? summary : buildResumeSummary(resume);
}

export function buildJobSummary(job) {
  const analysis = reusableAnalysis(job);
  const sourceEvidence = extractJobEvidence(job.description);
  return {
    version: SUMMARY_VERSION,
    sourceVersion: job.contentVersion,
    analysisResultId: analysis?.resultId || "",
    facts: Object.fromEntries(["title", "company", "location", "salary", "experience", "education"].map((key) => [key, job[key] || ""])),
    // 保留来自 JD 原文的短句证据，防止模型摘要丢失明确的职责或门槛。
    sourceEvidence,
    // 现有分析没有逐条原文引用，全部标记为模型归纳，不伪装成已核验的明确要求。
    analysis: analysis ? {
      essence: strings(analysis.essence),
      coreRequirements: strings(analysis.coreRequirements),
      inferredRequirements: normalizeHiddenRequirements(analysis.hiddenRequirements),
      idealCandidate: strings(analysis.idealCandidate)
    } : null
  };
}

export function buildResumeSummary(resume) {
  const entries = (key, fields) => (resume[key] || []).map((entry, index) => ({
    id: `${resume.id}:${resume.contentVersion}:${key}:${index}`,
    ...Object.fromEntries(fields.map((field) => [field, entry[field] || ""])),
    // 保留职责原句用于同次请求中的修改建议，去掉重复的 achievements 字段。
    details: strings(entry.description)
  }));
  return {
    version: SUMMARY_VERSION,
    sourceVersion: resume.contentVersion,
    jobIntent: resume.basicInfo?.jobIntent || "",
    location: resume.basicInfo?.location || "",
    education: entries("education", ["school", "degree", "major", "startDate", "endDate"]),
    workExperience: entries("workExperience", ["organization", "role", "startDate", "endDate"]),
    projects: entries("projects", ["name", "role", "startDate", "endDate"]),
    skills: strings(resume.skills),
    certifications: strings(resume.certifications),
    selfEvaluation: resume.selfEvaluation || "",
    // 未被标准章节接住的有效内容仍进入摘要，避免非模板化简历丢信息。
    otherHighlights: extractOtherResumeHighlights(resume)
  };
}

// 覆盖检查只作为保守回退信号，不声称能验证规则解析的语义准确性。
export function resumeNeedsRawText(resume, summary) {
  if (!summary.education.length && !summary.workExperience.length && !summary.projects.length) return true;
  const compact = (text) => String(text || "").replace(/[\s，,。；;：:、|｜/\-•·]/g, "").toLowerCase();
  const represented = compact(resumeSummaryText(summary));
  const contact = resume.basicInfo || {};
  const header = [contact.name, contact.phone, contact.email].filter(Boolean);
  const lines = (resume.sections || []).flatMap((section) => section.lines || []);
  if (!lines.length) return true;
  return lines.some((line) => {
    let text = String(line);
    header.forEach((value) => { text = text.replaceAll(value, ""); });
    const value = compact(text);
    return value.length > 8 && !represented.includes(value);
  });
}

export function resumeSummaryText(summary) {
  const lines = [];
  const add = (label, value) => { if (value) lines.push(`${label}：${value}`); };
  add("求职意向", summary.jobIntent);
  add("所在地", summary.location);
  for (const [key, label, fields] of [
    ["education", "教育", ["school", "degree", "major"]],
    ["workExperience", "工作", ["organization", "role"]],
    ["projects", "项目", ["name", "role"]]
  ]) {
    for (const entry of summary[key]) {
      // 长 ID 留在本地摘要中；模型本阶段不输出证据 ID，不重复发送标识。
      add(label, [entry.startDate, entry.endDate, ...fields.map((field) => entry[field])].filter(Boolean).join(" / "));
      lines.push(...entry.details);
    }
  }
  add("技能", summary.skills.join("、"));
  add("证书", summary.certifications.join("、"));
  add("自我评价", summary.selfEvaluation);
  for (const item of summary.otherHighlights || []) add("其他经历", item);
  return lines.join("\n");
}

function extractJobEvidence(description) {
  const lines = String(description || "")
    .split(/\n+|(?<=[。；;])/)
    .map((line) => line.replace(/^\s*(?:[-*•·]|\d+[.)、])\s*/, "").trim())
    .filter((line) => line.length >= 4 && line.length <= 180);
  const requirementSignal = /要求|任职|具备|熟悉|精通|优先|学历|经验|能力|技能|资格|必须/;
  const responsibilitySignal = /负责|职责|参与|推动|建设|设计|规划|运营|管理|交付|协同/;
  const unique = (items) => [...new Set(items)].slice(0, 8);
  return {
    requirements: unique(lines.filter((line) => requirementSignal.test(line))),
    responsibilities: unique(lines.filter((line) => responsibilitySignal.test(line)))
  };
}

function extractOtherResumeHighlights(resume) {
  const contact = resume.basicInfo || {};
  const contacts = [contact.name, contact.phone, contact.email].filter(Boolean);
  const knownHeadings = /^(?:个人信息|基本信息|联系方式|求职意向|应聘岗位|目标岗位|求职目标)$/;
  return [...new Set((resume.sections || [])
    .filter((section) => section.key === "unknown")
    .flatMap((section) => section.lines || [])
    .map((line) => contacts.reduce((text, value) => text.replaceAll(value, ""), String(line)).trim())
    .filter((line) => line.length > 4 && line.length <= 180 && !knownHeadings.test(line)))]
    .slice(0, 12);
}
