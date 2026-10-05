/**
 * 页面级导航与详情步骤切换；只修改 navigation state 和 DOM 激活态。
 * Controller 只连接 DOM、State 与业务动作，不包含 Prompt / Provider 细节。
 */
import { API_SETTINGS_ENABLED } from "../../shared/config/features.js";
import { qsa, qs } from "../../shared/ui/dom.js";
import { reusableAnalysis } from "../../shared/context/cache.js";
import { currentJob, state } from "../runtime.js";

let hooks = { onView: () => {}, onStep: () => {} };

export function configureNavigation(nextHooks = {}) {
  hooks = { ...hooks, ...nextHooks };
}

export function setView(view) {
  if (view === "settings" && !API_SETTINGS_ENABLED) return;
  state.navigation.view = view;
  const contentView = view === "home" ? "jobs" : view;
  qsa(".view").forEach((node) => node.classList.remove("active"));
  qs(`#${contentView}View`).classList.add("active");
  qs("#jobsView").classList.toggle("is-home", view === "home");
  qs("#emptyPanel").classList.toggle("is-hidden", state.jobs.length > 0 && view !== "home");
  qs("#searchRow").classList.toggle("is-hidden", state.jobs.length === 0 || view === "home");
  qsa(".top-tabs button").forEach((button) => {
    const active = button.dataset.tab === view && (view !== "jobs" || state.jobs.length > 0);
    button.classList.toggle("active", active);
  });
  qs("#plugin").classList.toggle("task-mode", ["detail", "settings", "manual", "help", "feedback"].includes(view));
  hooks.onView(view);
}

export function setStep(step) {
  if (["match", "revision", "greeting"].includes(step) && reusableAnalysis(currentJob())?.isJobDescription === false) step = "analysis";
  state.navigation.step = step;
  qsa(".step-view").forEach((node) => node.classList.remove("active"));
  qs(`#${step}Step`).classList.add("active");
  qsa(".flow-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.step === step));
  qs("#detailView").classList.toggle("detail-mode", step === "jd");
  hooks.onStep(step);
}

export function openJob(index, step, returnView = "jobs", options = {}) {
  state.navigation.selectedJob = index;
  state.navigation.returnView = returnView;
  qs("#backBtn").textContent = "‹ 返回";
  setView("detail");
  setStep(step);
  if (options.afterOpen) options.afterOpen();
}

export function bindNavigationEvents() {
  const menu = qs("#headerMenu");
  const menuButton = qs("#moreMenuBtn");
  const closeMenu = () => {
    menu.classList.add("is-hidden");
    menuButton.setAttribute("aria-expanded", "false");
  };
  const menuItems = () => qsa(".header-menu-item").filter((item) => !item.classList.contains("is-hidden") && !item.disabled);
  const openUtilityView = (view) => {
    if (view === "settings" && !API_SETTINGS_ENABLED) return;
    // 在辅助页再次点击当前菜单项时只关闭菜单，避免把返回目标覆盖成当前页。
    if (state.navigation.view === view) {
      closeMenu();
      return;
    }
    // 只有从非辅助页进入时才记录返回目标；辅助页之间切换仍返回原业务页。
    if (!["settings", "help", "feedback"].includes(state.navigation.view)) {
      state.navigation.utilityReturnView = state.navigation.view;
    }
    closeMenu();
    setView(view);
    qs(`#${view}BackBtn`)?.focus();
  };

  qs("#homeBtn").addEventListener("click", () => {
    closeMenu();
    setView("home");
    // 品牌入口进入独立欢迎首页，不清空搜索、岗位或进行中的任务。
    qs("#jobsView").scrollTop = 0;
  });

  menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.classList.contains("is-hidden");
    menu.classList.toggle("is-hidden", !willOpen);
    menuButton.setAttribute("aria-expanded", String(willOpen));
    if (willOpen) menuItems()[0]?.focus();
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".header-menu-wrap")) closeMenu();
  });
  menu.addEventListener("keydown", (event) => {
    const items = menuItems();
    const index = items.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      menuButton.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !items.length) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (index + 1 + items.length) % items.length
          : (index - 1 + items.length) % items.length;
    items[nextIndex].focus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu.classList.contains("is-hidden")) return;
    closeMenu();
    menuButton.focus();
  });

  qs("#settingsBtn").addEventListener("click", () => openUtilityView("settings"));
  qs("#helpBtn").addEventListener("click", () => openUtilityView("help"));
  qs("#feedbackBtn").addEventListener("click", () => openUtilityView("feedback"));
  for (const id of ["#settingsBackBtn", "#helpBackBtn", "#feedbackBackBtn"]) {
    qs(id).addEventListener("click", () => setView(state.navigation.utilityReturnView));
  }
  qs("#settingsBtn").classList.toggle("is-hidden", !API_SETTINGS_ENABLED);

  qs("#backBtn").addEventListener("click", () => setView(state.navigation.returnView));
  qsa(".top-tabs button").forEach((button) => button.addEventListener("click", () => setView(button.dataset.tab)));
  qsa(".flow-tabs button").forEach((button) => button.addEventListener("click", () => setStep(button.dataset.step)));
}
