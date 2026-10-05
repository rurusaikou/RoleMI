/**
 * UI 状态模型。
 *
 * AI Task 统一使用 idle / loading / success / error 四态，避免多个 Boolean 组合
 * 导致“到底处于什么状态”不明确。
 */
// 所有异步 AI UI 都只能处于以下四种状态之一。
export const TASK_STATUS = Object.freeze({
  IDLE: "idle",
  LOADING: "loading",
  SUCCESS: "success",
  ERROR: "error"
});

/** 创建统一 Task State；extra 用于 loadingJobId、dependency key 等任务专属字段。 */
export function createTaskState(extra = {}) {
  return { status: TASK_STATUS.IDLE, error: null, result: null, ...extra };
}

export function createInitialState() {
  return {
    navigation: {
      view: "jobs",
      step: "jd",
      selectedJob: 0,
      returnView: "jobs",
      utilityReturnView: "jobs",
      search: ""
    },
    jobs: [],
    resumeState: { uploaded: false, parsing: false, understanding: false, uploadError: null, profileError: null, data: null },
    tasks: {
      deepAnalysis: createTaskState({ loadingJobId: null }),
      resumeMatch: createTaskState({ key: "" }),
      resumeRevision: createTaskState({ key: "" }),
      greeting: createTaskState({ result: "" })
    }
  };
}

export function resetTask(taskState, result = null) {
  Object.assign(taskState, { status: TASK_STATUS.IDLE, error: null, result });
}

export function startTask(taskState) {
  Object.assign(taskState, { status: TASK_STATUS.LOADING, error: null });
}

export function succeedTask(taskState, result = taskState.result) {
  Object.assign(taskState, { status: TASK_STATUS.SUCCESS, error: null, result });
}

export function failTask(taskState, error) {
  Object.assign(taskState, { status: TASK_STATUS.ERROR, error: error || "请求失败，请重试。" });
}
