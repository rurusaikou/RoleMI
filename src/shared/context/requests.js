/**
 * 异步任务请求登记表：按任务与岗位维护最新 ticket，提供失效和完成操作。
 * 以 ticket 身份防止同一依赖键下的旧请求覆盖新请求。
 */
// 同一任务、同一岗位只接受最新请求；切换页面不会取消原岗位的保存资格。
export function createRequestRegistry() {
  const requests = new Map();
  const slot = (task, jobId) => `${task}:${jobId}`;
  return {
    start(task, jobId, key) {
      const ticket = { task, jobId, key, loading: true, error: "" };
      requests.set(slot(task, jobId), ticket);
      return ticket;
    },
    // 比较对象身份：即使两次请求的依赖 key 相同，也只允许最新一次写回。
    isCurrent(ticket) {
      return requests.get(slot(ticket.task, ticket.jobId)) === ticket;
    },
    get(task, jobId, key) {
      const ticket = requests.get(slot(task, jobId));
      return ticket?.key === key ? ticket : null;
    },
    finish(ticket, error = "") {
      if (this.isCurrent(ticket)) Object.assign(ticket, { loading: false, error });
    },
    // 失效仅撤销 ticket 的写回资格，不会中止已发出的网络请求。
    invalidate(task, jobId) {
      for (const [key, ticket] of requests) {
        if ((!task || ticket.task === task) && (!jobId || ticket.jobId === jobId)) requests.delete(key);
      }
    }
  };
}
