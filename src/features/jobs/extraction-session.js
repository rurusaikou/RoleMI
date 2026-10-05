/**
 * 网页岗位提取事务：统一入口互斥，并用递增代次隔离清空后的迟到结果。
 * 该状态不负责 DOM 或持久化，便于独立验证异步完成顺序。
 */
export function createExtractionSession() {
  let generation = 0;
  let activeToken = null;

  return {
    begin() {
      if (activeToken !== null) return null;
      activeToken = ++generation;
      return activeToken;
    },
    isCurrent(token) {
      return token === generation;
    },
    finish(token) {
      if (activeToken !== token) return false;
      activeToken = null;
      return true;
    },
    invalidate() {
      generation += 1;
      activeToken = null;
    }
  };
}

export function shouldReturnToJobs(startedFromHome, currentView) {
  return startedFromHome && currentView === "home";
}
