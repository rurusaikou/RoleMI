/**
 * 岗位池及收藏卡片渲染：构建搜索文本、展示标签和操作按钮。
 * 业务文本经 HTML 转义，事件绑定由 Controller 负责。
 */
import { escapeHtml } from "../../shared/ui/dom.js";
import { reusableAnalysis } from "../../shared/context/cache.js";
import { isManualJob } from "./manual.js";
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
  const stale = hasStaleAnalysis(job);
  return jobCardTemplate(job, index, {
    selected,
    favorite: false,
    starTitle: "收藏",
    actions: `
      <div class="job-analysis-footer">
        <span>${stale ? "岗位信息已更新 · 建议重新分析" : analyzed ? "已有分析结果" : "尚未分析"}</span>
        <button class="soft-btn" data-action="analyze" type="button">${stale ? "重新分析" : analyzed ? "查看分析" : "分析岗位"} <i aria-hidden="true">→</i></button>
      </div>
    `
  });
}

export function favoriteCard(job, index) {
  const analyzed = Boolean(reusableAnalysis(job));
  const stale = hasStaleAnalysis(job);
  return jobCardTemplate(job, index, {
    selected: false,
    favorite: true,
    starTitle: "取消收藏",
    actions: `
      <div class="job-analysis-footer">
        <span>${stale ? "岗位信息已更新 · 建议重新分析" : analyzed ? "已有分析结果" : "尚未分析"}</span>
        <button class="soft-btn" data-action="intelligence" type="button">${stale ? "重新分析" : analyzed ? "查看分析" : "分析岗位"} <i aria-hidden="true">→</i></button>
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
        <div class="job-card-actions">
          <button class="star-btn ${job.starred ? "active" : ""}" data-action="star" type="button" title="${options.starTitle}" aria-label="${options.starTitle}">★</button>
          <div class="job-card-menu-wrap">
            <button class="job-more-btn" data-action="more" type="button" aria-label="更多岗位操作" aria-haspopup="menu" aria-expanded="false">⋯</button>
            <div class="job-card-menu is-hidden" role="menu">
              ${isManualJob(job) ? `<button data-action="edit" role="menuitem" type="button"><span aria-hidden="true">✎</span>编辑岗位</button>` : ""}
              <button class="danger-menu-item" data-action="delete" role="menuitem" type="button"><span aria-hidden="true">×</span>删除岗位</button>
            </div>
          </div>
        </div>
      </div>
      <div class="job-tags">${tags}</div>
      ${options.actions}
    </article>
  `;
}

// 只把岗位内容版本变化导致的旧分析视为“信息已更新”，不误报 Prompt 版本升级等其他失效原因。
export function hasStaleAnalysis(job) {
  const storedVersion = job?.deepAnalysis?.dependencies?.jobVersion;
  return Boolean(job?.deepAnalysis && storedVersion && storedVersion !== job.contentVersion);
}

export function companyFactsLine(job) {
  // 公司画像是可选补充字段；缺失时不显示空占位，也不影响岗位详情和分析入口。
  return [job?.companyIndustry, job?.companyStage, job?.companyScale].filter(Boolean).join(" · ");
}

function metaLine(job) {
  return [job.location, job.salary, job.experience, job.education].filter(Boolean).join(" · ") || "岗位信息待核对";
}
