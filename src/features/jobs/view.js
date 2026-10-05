/**
 * 岗位池及收藏卡片渲染：构建搜索文本、展示标签和操作按钮。
 * 业务文本经 HTML 转义，事件绑定由 Controller 负责。
 */
import { escapeHtml } from "../../shared/ui/dom.js";
import { reusableAnalysis } from "../../shared/context/cache.js";
import { keywordsFor } from "./intelligence.js";

export function jobSearchText(job) {
  // 搜索只覆盖列表可见和可推断字段，不把完整 JD 放进列表搜索，避免长文本拖慢输入。
  return [
    job.title,
    job.company,
    job.location,
    job.salary,
    job.experience,
    job.education,
    job.sourceSite,
    keywordsFor(job).join(" ")
  ].join(" ");
}

export function jobCard(job, index, selected) {
  const analyzed = Boolean(reusableAnalysis(job));
  return jobCardTemplate(job, index, {
    selected,
    favorite: false,
    starTitle: "收藏",
    actions: `
      <div class="job-analysis-footer">
        <span>${analyzed ? "已有分析结果" : "尚未分析"}</span>
        <button class="soft-btn" data-action="analyze" type="button">${analyzed ? "查看分析" : "分析岗位"} <i aria-hidden="true">→</i></button>
      </div>
    `
  });
}

export function favoriteCard(job, index) {
  const analyzed = Boolean(reusableAnalysis(job));
  return jobCardTemplate(job, index, {
    selected: false,
    favorite: true,
    starTitle: "取消收藏",
    actions: `
      <div class="job-analysis-footer">
        <span>${analyzed ? "已有分析结果" : "尚未分析"}</span>
        <button class="soft-btn" data-action="intelligence" type="button">${analyzed ? "查看分析" : "分析岗位"} <i aria-hidden="true">→</i></button>
      </div>
    `
  });
}

function jobCardTemplate(job, index, options) {
  const tags = keywordsFor(job).slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");

  return `
    <article class="job-card ${options.selected ? "selected" : ""} ${options.favorite ? "favorite-card" : ""}" data-job="${index}">
      <button class="job-card-detail-hit" data-action="detail" type="button" aria-label="查看岗位详情：${escapeHtml(job.title || "未识别职位名")}"></button>
      <div class="job-top">
        <div>
          <h2>${escapeHtml(job.title || "未识别职位名")}</h2>
          <p>${escapeHtml(job.company || "公司待核对")}<br>${escapeHtml(metaLine(job))}</p>
        </div>
        <button class="star-btn ${job.starred ? "active" : ""}" data-action="star" type="button" title="${options.starTitle}" aria-label="${options.starTitle}">★</button>
      </div>
      <div class="job-tags">${tags}</div>
      ${options.actions}
    </article>
  `;
}

function metaLine(job) {
  return [job.location, job.salary, job.experience, job.education].filter(Boolean).join(" · ") || "岗位信息待核对";
}
