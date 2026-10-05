/**
 * 简历与理解结果存储：维护内容版本、派生摘要及非简历拒绝记录。
 * 保存理解结果前校验简历身份和内容版本，防止旧请求覆盖新上传。
 */
import { RESUME_KEY } from "../../shared/config/constants.js";
import { getLocal, setLocal } from "../../shared/storage/chrome-storage.js";
import { contentVersion, newId, resumeContent } from "../../shared/context/identity.js";
import { PROMPT_VERSIONS, RESUME_PROFILE_VERSION } from "../../shared/context/cache.js";
import { buildResumeSummary } from "../../shared/context/summaries.js";

export async function getResume() {
  const data = await getLocal({ [RESUME_KEY]: null });
  return data[RESUME_KEY] ? setResume(data[RESUME_KEY]) : null;
}

export async function setResume(resume) {
  const version = await contentVersion(resumeContent(resume));
  const data = await getLocal({ [RESUME_KEY]: null });
  const previous = data[RESUME_KEY];
  const sameContent = previous?.contentVersion === version;
  // 只接受与当前内容版本明确绑定的传入 Profile。这样即使调用方带着旧 resume 对象
  // 修改了正文，也不会因为 ...resume 把旧 Profile 一起写回新版本。
  const incomingProfile = resume.profile?.sourceVersion === version ? resume.profile : null;
  const next = {
    ...resume,
    // 重传同内容文件保留身份；不同内容获得新身份，即使文件名相同。
    id: resume.id || (sameContent ? previous.id : null) || newId("resume"),
    contentVersion: version,
    // Resume Profile 属于内容版本的派生缓存：同内容重传可复用，不同内容必须失效。
    profile: incomingProfile || (sameContent ? previous?.profile : null) || null
  };
  next.summary = buildResumeSummary(next);
  await setLocal({ [RESUME_KEY]: next });
  return next;
}


export async function saveResumeProfile(resumeSnapshot, profileData) {
  const data = await getLocal({ [RESUME_KEY]: null });
  const current = data[RESUME_KEY];
  if (!current || current.id !== resumeSnapshot?.id || current.contentVersion !== resumeSnapshot?.contentVersion) return null;

  const next = {
    ...current,
    profile: {
      ...profileData,
      resultId: newId("resume_profile"),
      version: RESUME_PROFILE_VERSION,
      promptVersion: PROMPT_VERSIONS.resume_profile,
      sourceVersion: current.contentVersion,
      updatedAt: new Date().toISOString()
    }
  };
  await setLocal({ [RESUME_KEY]: next });
  return next;
}

export async function clearResume() {
  await setLocal({ [RESUME_KEY]: null });
  return null;
}
