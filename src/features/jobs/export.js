/**
 * 岗位 Excel 导出：按当前依赖版本筛选结果，生成表格并发起本地下载。
 * 非空导出记录模块执行事件；成功表示下载调用完成，不代表文件已落盘。
 */
import { trackUsage } from "../../shared/backend/usage.js";
import { normalizeTransferableMatch, normalizeRevision } from "../../shared/context/match-results.js";
import { hiddenRequirementsToText } from "../../shared/context/hidden-requirements.js";
import { flashButton } from "../../shared/ui/dom.js";
import { dedupeJobs, inferSourceSite } from "./repository.js";
import { chromeAsync } from "../../shared/storage/chrome-storage.js";
import { isResultCurrent, reusableAnalysis } from "../../shared/context/cache.js";

export async function exportJobs(jobs, button, emptyText, resume, exportScope = "全部岗位") {
  if (button.disabled) return;
  if (!jobs.length) {
    flashButton(button, emptyText);
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const label = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = "导出中…";
  try {
    await trackUsage("excel_export", () => downloadWorkbook(jobs, exportFilename(exportScope, date), resume));
    button.textContent = "已导出";
  } catch {
    button.textContent = "导出失败，请重试";
  } finally {
    button.removeAttribute("aria-busy");
    setTimeout(() => {
      button.disabled = false;
      button.textContent = label;
    }, 900);
  }
}

export function jobRows(jobs, resume) {
  return dedupeJobs(jobs).map((job) => {
    const analysis = reusableAnalysis(job) || {};
    const resumeMatch = isResultCurrent("resume_match", job.resumeMatch, { job, resume }) ? job.resumeMatch : {};
    const match = resumeMatch.result || {};
    // 导出与页面共用版本校验，历史无版本记录和旧简历结果不会冒充当前分析。
    const greeting = isResultCurrent("greeting", job.greeting, {
      job, resume, tone: job.greeting?.tone, maxChars: job.greeting?.maxChars
    }) ? job.greeting : {};
    const greetingResult = greeting.result || {};
    return {
      "岗位": job.title || "",
      "公司": job.company || "",
      "工作地点": job.location || "",
      "工作经验": job.experience || "",
      "学历要求": job.education || "",
      "薪资": job.salary || "",
      "岗位描述": job.description || "",
      "发布日期": job.postedDate || "",
      "来源网站": job.sourceSite || inferSourceSite(job.sourceUrl),
      "来源链接": job.sourceUrl || "",
      "岗位本质": joinList(analysis.essence),
      "核心要求": joinList(analysis.coreRequirements),
      "隐形要求": hiddenRequirementsToText(analysis.hiddenRequirements),
      "理想候选人": joinList(analysis.idealCandidate),
      "匹配等级": match.level || "",
      "匹配说明": match.reason || "",
      "直接匹配": joinObjects(match.directMatches, ["requirement", "experience", "proof"]),
      "可迁移能力": joinObjects((match.transferableMatches || []).map(normalizeTransferableMatch), ["requirement", "experience", "transferability", "boundary"]),
      "关键缺口": joinObjects(match.gaps, ["gap", "impact"]),
      "简历修改建议": joinObjects((match.revisions || []).map(normalizeRevision), ["category", "summary", "original", "rewrite", "reason"]),
      "求职开场白": greetingResult.greeting || ""
    };
  });
}

export function exportFilename(exportScope, date = new Date().toISOString().slice(0, 10)) {
  const scope = exportScope === "收藏岗位" ? "收藏岗位" : "全部岗位";
  return `RoleMI-${scope}-${date}.xlsx`;
}

function joinList(items) {
  return (items || []).filter(Boolean).join("\n");
}

function joinObjects(items, keys) {
  return (items || []).map((item, index) => {
    const text = keys.map((key) => item && item[key]).filter(Boolean).join("｜");
    return text ? `${index + 1}. ${text}` : "";
  }).filter(Boolean).join("\n");
}

async function downloadWorkbook(jobs, filename, resume) {
  const blob = window.ROLEMI_XLSX.createWorkbookBlob(jobRows(jobs, resume), "岗位信息");
  await downloadBlob(blob, filename, true);
}

async function downloadBlob(blob, filename, saveAs) {
  const url = URL.createObjectURL(blob);

  if (window.chrome && chrome.downloads) {
    await chromeAsync((done) => {
      chrome.downloads.download({ url, filename, saveAs }, done);
    });
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return;
  }

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
