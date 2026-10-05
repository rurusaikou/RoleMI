/**
 * 岗位列表的本地关键词提取：基于岗位字段与词库生成展示标签，不调用 AI。
 */
import { JOB_KEYWORDS } from "../../shared/data/job-keywords.js";

export function keywordsFor(job) {
  const text = `${job.title} ${job.description}`.toLowerCase();
  const sourceText = jobSearchTextWithoutKeywords(job);
  const hits = JOB_KEYWORDS.filter((keyword) => text.includes(keyword.toLowerCase()) || sourceText.includes(keyword));
  return hits.length ? hits : [job.sourceSite, job.experience, job.education].filter(Boolean).slice(0, 4);
}

function jobSearchTextWithoutKeywords(job) {
  return [job.title, job.company, job.location, job.salary, job.experience, job.education, job.description].join(" ");
}
