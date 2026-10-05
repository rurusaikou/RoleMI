/**
 * DOCX 本地解析适配器：通过随扩展分发的 Mammoth 提取并规范化文本。
 */
import { normalizeResumeText } from "./normalize.js";

export async function parseDocxResume(file) {
  const mammoth = window.mammoth;
  if (!mammoth || !mammoth.extractRawText) {
    throw new Error("Word 解析库未加载，请刷新插件或检查本地 Mammoth.js 文件。");
  }

  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return normalizeResumeText(result.value || "");
}
