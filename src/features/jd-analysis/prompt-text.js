/**
 * 将结构化岗位分析转为文本，保留隐形要求及其依据。
 */
import { hiddenRequirementsToText } from "../../shared/context/hidden-requirements.js";
export function jdAnalysisToText(analysis) {
  if (!analysis) return "";

  return [
    analysis.essence && analysis.essence.length ? `岗位本质：${analysis.essence.join("、")}` : "",
    analysis.coreRequirements && analysis.coreRequirements.length ? `核心要求：${analysis.coreRequirements.join("、")}` : "",
    analysis.hiddenRequirements && analysis.hiddenRequirements.length ? `隐形要求：${hiddenRequirementsToText(analysis.hiddenRequirements, "、")}` : "",
    analysis.idealCandidate && analysis.idealCandidate.length ? `理想候选人：${analysis.idealCandidate.join("、")}` : ""
  ].filter(Boolean).join("\n");
}
