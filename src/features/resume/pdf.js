/**
 * PDF 本地解析适配器：配置随扩展分发的 PDF.js Worker 并提取页面文本。
 * 保留可识别的行列边界，不提供扫描图像 OCR。
 */
import { normalizeResumeText } from "./normalize.js";

export async function parsePdfResume(file) {
  const pdfjs = window.pdfjsLib;
  if (!pdfjs || !pdfjs.getDocument) {
    throw new Error("PDF 解析库未加载，请刷新插件或检查本地 PDF.js 文件。");
  }

  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc();
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(textContentToLines(content.items).join("\n"));
  }

  return normalizeResumeText(pages.join("\n\n"));
}

function workerSrc() {
  if (window.chrome && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL("src/vendor/pdf.worker.min.js");
  }
  return "./vendor/pdf.worker.min.js";
}

function textContentToLines(items) {
  const rows = new Map();

  for (const item of items) {
    if (!item || !item.str) continue;
    const y = Math.round(item.transform && item.transform[5] ? item.transform[5] : 0);
    const x = item.transform && item.transform[4] ? item.transform[4] : 0;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x, text: item.str });
  }

  // PDF 坐标自下而上，先按 y 倒序恢复阅读顺序，再按 x 拼接同一行。
  return Array.from(rows.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join(" ").trim())
    .filter(Boolean);
}
