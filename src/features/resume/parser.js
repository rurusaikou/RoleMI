/**
 * 简历文件解析入口：检查文件大小与类型，分发到 PDF / DOCX 解析器。
 * 只负责文件读取，语义理解和持久化由后续流程处理。
 */
import { parseDocxResume } from "./docx.js";
import { parsePdfResume } from "./pdf.js";

const MAX_RESUME_FILE_SIZE = 12 * 1024 * 1024;

export async function parseResumeFile(file) {
  if (!file) throw new Error("请选择 PDF 或 DOCX 简历。");
  if (file.size > MAX_RESUME_FILE_SIZE) throw new Error("简历文件超过 12MB，请压缩后再上传。");

  // 入口只做文件类型分发；后续结构化统一走 extractor，避免解析器里混业务规则。
  const fileName = file.name || "";
  const extension = fileName.split(".").pop().toLowerCase();

  if (extension === "pdf" || file.type === "application/pdf") {
    return {
      fileType: "pdf",
      text: await parsePdfResume(file)
    };
  }

  if (extension === "docx" || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return {
      fileType: "docx",
      text: await parseDocxResume(file)
    };
  }

  if (extension === "doc") throw new Error("暂不支持 DOC，请另存为 DOCX 后上传。");
  throw new Error("当前只支持 PDF 和 DOCX 简历。");
}
