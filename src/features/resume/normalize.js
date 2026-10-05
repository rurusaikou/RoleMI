/**
 * 简历文本规范化工具：统一空白、换行和列分隔，提供行级文本清理。
 */
export function normalizeResumeText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    // PDF 和 DOCX 常用 Tab 或连续空格表达列边界，先保留成可解析的分隔符。
    .replace(/[ \t]{2,}/g, " ｜ ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*｜\s*/g, " ｜ ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

export function compactLine(line) {
  return String(line || "").replace(/\s+/g, "").trim();
}
