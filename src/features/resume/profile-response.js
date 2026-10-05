/**
 * 简历理解响应解析：校验有效性、规范化结构化事实并拒绝非简历输入。
 */
import { AiOutputFormatError } from "../../shared/ai/errors.js";
import { extractResponseContent } from "../../shared/ai/response.js";

export function parseResumeProfileResponse(payload) {
  const content = extractResponseContent(payload);
  if (!content) {
    throw new AiOutputFormatError("简历理解没有返回最终内容。", { reason: "empty_output" });
  }

  let parsed;
  try {
    parsed = JSON.parse(content.trim().replace(/```(?:json)?/gi, "").replace(/```/g, "").trim());
  } catch (_error) {
    throw new AiOutputFormatError("简历理解返回的 JSON 无法解析。", {
      reason: "incomplete_json",
      details: { tail: content.slice(-240) }
    });
  }

  return normalizeProfile(parsed);
}

// 以字段白名单归一化模型输出；自由文本仅清理空白，此处不执行联系方式脱敏。
function normalizeProfile(value) {
  const data = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (data.validResume === false) {
    throw new AiOutputFormatError("输入无法识别为简历或候选人履历信息，请上传有效简历。", { reason: "invalid_resume" });
  }
  const profile = {
    jobIntent: clean(data.jobIntent),
    location: clean(data.location),
    education: normalizeEducation(data.education),
    workExperience: normalizeExperiences(data.workExperience),
    projects: normalizeProjects(data.projects),
    skills: strings(data.skills),
    certifications: strings(data.certifications),
    languages: strings(data.languages),
    otherEvidence: strings(data.otherEvidence)
  };

  const useful = profile.education.length || profile.workExperience.length || profile.projects.length || profile.skills.length || profile.otherEvidence.length;
  if (!useful) throw new AiOutputFormatError("简历理解没有提取出可用于匹配的事实。", { reason: "empty_profile" });
  return profile;
}

function normalizeEducation(items) {
  return objects(items).map((item) => ({
    school: clean(item.school),
    degree: clean(item.degree),
    major: clean(item.major),
    period: clean(item.period),
    details: strings(item.details)
  })).filter((item) => item.school || item.major || item.details.length);
}

function normalizeExperiences(items) {
  return objects(items).map((item) => ({
    organization: clean(item.organization),
    role: clean(item.role),
    period: clean(item.period),
    details: strings(item.details),
    technologies: strings(item.technologies)
  })).filter((item) => item.organization || item.role || item.details.length);
}

function normalizeProjects(items) {
  return objects(items).map((item) => ({
    name: clean(item.name),
    role: clean(item.role),
    period: clean(item.period),
    organization: clean(item.organization),
    details: strings(item.details),
    technologies: strings(item.technologies)
  })).filter((item) => item.name || item.details.length);
}

function objects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)) : [];
}

function strings(value) {
  return Array.isArray(value) ? [...new Set(value.map(clean).filter(Boolean))] : [];
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
