/**
 * App 入口编排器。
 *
 * 只负责：组装各 Controller、绑定事件、初始化数据、触发全局刷新。
 * 业务规则放在 features，AI 工作流放在 task-runner，持久状态同步放在 runtime。
 */
import { API_SETTINGS_ENABLED } from "../shared/config/features.js";
import { loadSettings } from "../features/settings/service.js";
import { bindSettingsEvents } from "./controllers/settings-controller.js";
import { cachedUsage } from "../shared/backend/usage.js";
import { reusableAnalysis } from "../shared/context/cache.js";
import { getJobs } from "../features/jobs/repository.js";
import { setStatus } from "../shared/ui/dom.js";
import { state, requests, syncTaskState } from "./runtime.js";
import { bindNavigationEvents, configureNavigation, openJob, setStep, setView } from "./controllers/navigation-controller.js";
import { bindJobsEvents, configureJobsController, renderFavorites, renderJobSummary } from "./controllers/jobs-controller.js";
import { bindDetailEvents, configureDetailController, renderDetail, startDeepAnalysis } from "./controllers/detail-controller.js";
import { bindResumeEvents, configureResumeController, renderResumeFlow, restoreResumeState } from "./controllers/resume-controller.js";
import { bindGreetingEvents, configureGreetingController, renderGreeting } from "./controllers/greeting-controller.js";
import { bindFeedbackEvents, renderFeedbackJobs } from "./controllers/feedback-controller.js";

function refresh() {
  syncTaskState();
  renderJobSummary();
  renderDetail();
  renderResumeFlow();
  renderGreeting();
  renderFeedbackJobs();
}

function openJobFromList(index, step, returnView = "jobs", options = {}) {
  if (step === "analysis" && !options.analyze && reusableAnalysis(state.jobs[index])) cachedUsage("deep_analysis");
  openJob(index, step, returnView, {
    afterOpen: options.analyze ? () => startDeepAnalysis(index) : undefined
  });
  refresh();
}

function configureControllers() {
  configureNavigation({
    onView: (view) => { if (view === "favorites") renderFavorites(); },
    onStep: () => { renderResumeFlow(); renderGreeting(); }
  });
  configureJobsController({ openJob: openJobFromList, refresh, setView });
  configureDetailController({ refresh, setStep });
  configureResumeController({ refresh, setStep });
  configureGreetingController({ refresh, setStep });
}

function bindEvents() {
  bindNavigationEvents();
  if (API_SETTINGS_ENABLED) bindSettingsEvents();
  bindJobsEvents();
  bindDetailEvents();
  bindResumeEvents();
  bindGreetingEvents();
  bindFeedbackEvents();
}

async function init() {
  configureControllers();
  bindEvents();
  const failures = [];
  if (API_SETTINGS_ENABLED) {
    try {
      await loadSettings();
    } catch (_error) {
      failures.push("服务设置");
    }
  }
  try {
    state.jobs = await getJobs();
  } catch (_error) {
    failures.push("岗位池");
    state.jobs = [];
  }
  try {
    await restoreResumeState();
  } catch (_error) {
    failures.push("简历");
  }
  refresh();
  setView("jobs");
  setStep("jd");
  setStatus(failures.length ? `${failures.join("、")}加载失败，请刷新后重试` : "今天在看什么机会？ 👋");
}

init().catch((error) => setStatus(error.message || "初始化失败"));
