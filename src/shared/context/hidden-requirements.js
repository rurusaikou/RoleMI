/**
 * 隐形要求兼容与文本转换：统一为要求 / 依据对象，读取旧字符串但不补造依据。
 */
const cleanText = (value) => typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

// 旧缓存及 Markdown 兜底仍可能带字符串；统一迁移为对象，不猜测缺失依据。
export function normalizeHiddenRequirements(value) {
  const rows = Array.isArray(value) ? value : [value];
  return rows.map((item) => {
    if (typeof item === "string") {
      const [requirement, ...basis] = item.split("｜");
      return { requirement: cleanText(requirement), basis: cleanText(basis.join("｜")) };
    }
    return { requirement: cleanText(item?.requirement), basis: cleanText(item?.basis) };
  }).filter((item) => item.requirement && item.requirement !== "[object Object]").slice(0, 5);
}

export function hiddenRequirementsToText(value, separator = "\n") {
  return normalizeHiddenRequirements(value).map(({ requirement, basis }) =>
    basis ? `${requirement}｜依据：${basis.replace(/^依据[：:]\s*/, "")}` : requirement
  ).join(separator);
}
