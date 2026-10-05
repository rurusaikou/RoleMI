/**
 * 招聘页面内容脚本：读取页面 DOM、还原薪资字符并响应 JD 提取消息。
 * 通过扩展消息与侧栏通信，不调用模型。
 */
(function () {
  // content script 运行在招聘网站页面里，负责读取真实 DOM。
  // 侧边栏面板不直接访问页面 DOM，而是通过 chrome.tabs.sendMessage 调用这里的能力。

  // BOSS 直聘会用私有 Unicode 字符渲染薪资数字。
  // 这里把当前已验证的一组字符还原为普通数字，保证 Excel 中能看到真实薪资。
  const MASKED_DIGIT_MAP = {
    "\ue030": "0",
    "\ue031": "0",
    "\ue032": "1",
    "\ue033": "2",
    "\ue034": "3",
    "\ue035": "4",
    "\ue036": "5",
    "\ue037": "6",
    "\ue038": "7",
    "\ue039": "8",
    "\ue03a": "9"
  };

  const EXPERIENCE_PATTERN = /(经验不限|在校\/应届|应届生?|无经验|\d+\s*年以内|\d+\s*-\s*\d+\s*年|\d+\s*年以上|1年以下|1-3年|3-5年|5-10年|10年以上)/;
  const EDUCATION_PATTERN = /(学历不限|中专\/中技|高中|大专|本科|硕士|博士|MBA|EMBA)/i;

  // 统一的职位数据结构。
  // 这样每个提取器都返回同一组字段，侧边栏面板导出 Excel 时不用关心来源站点。
  // 只保留岗位池展示、分析与导出共同需要的字段，避免把页面噪声写入本地数据。
  const EMPTY_JOB = {
    title: "",
    company: "",
    location: "",
    experience: "",
    education: "",
    salary: "",
    description: "",
    postedDate: "",
    sourceSite: "",
    sourceUrl: ""
  };

  // 页面文本会带有 nbsp、多余换行、连续空格，以及 BOSS 的遮盖数字。
  // 所有字段在进入存储和导出前都走这里，减少各提取器重复清洗。
  function cleanText(value) {
    return normalizeMaskedDigits(value)
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  // BOSS 的薪资数字不是普通 0-9，而是 E030-E03A 私有字符。
  // 映射在文本清洗最前面执行，后续薪资正则才能正常识别。
  function normalizeMaskedDigits(value) {
    return String(value || "").replace(/[\ue030-\ue03a]/g, (char) => MASKED_DIGIT_MAP[char] || char);
  }

  // DOM 节点文本读取的安全包装：允许传入 null，并统一走 cleanText。
  // 对页面 selector 改动很频繁的场景，这能减少空节点运行时报错。
  function textOf(node) {
    return cleanText(node && node.innerText);
  }

  // 按顺序尝试多个 selector，返回第一个非空文本。
  // 不同招聘站点 selector 差异较大，集中封装可以减少重复空值判断。
  function firstText(selectors, root) {
    const scope = root || document;

    for (const selector of selectors) {
      const text = textOf(scope.querySelector(selector));
      if (text) return text;
    }

    return "";
  }

  function childText(selector, index, root) {
    // 有些站点把地点/经验/学历放在同一组 li/span 中，按固定序号取最稳定。
    const scope = root || document;
    const nodes = Array.from(scope.querySelectorAll(selector));
    return textOf(nodes[index]);
  }

  function lastChildText(selector, root) {
    // 猎聘发布日期在 job-properties 最后一个 span 中，单独封装便于表达这个结构。
    const scope = root || document;
    const nodes = Array.from(scope.querySelectorAll(selector));
    return textOf(nodes[nodes.length - 1]);
  }

  function normalizePostedDate(value) {
    // 招聘站点常把日期写成“7月2日更新/3天前”，导出前统一尽量转成 YYYY-MM-DD。
    const text = cleanText(value).replace(/发布|更新|刷新/g, "");
    if (!text) return "";

    if (/今天|今日/.test(text)) return formatDateFromDate(offsetDate(0));
    if (/昨天|昨日/.test(text)) return formatDateFromDate(offsetDate(1));
    if (/前天/.test(text)) return formatDateFromDate(offsetDate(2));

    const daysAgoMatch = text.match(/(\d+)\s*天前/);
    if (daysAgoMatch) return formatDateFromDate(offsetDate(Number(daysAgoMatch[1])));

    const isoMatch = text.match(/(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/);
    if (isoMatch) return formatDate(isoMatch[1], isoMatch[2], isoMatch[3]);

    const monthDayMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
    if (monthDayMatch) return formatMonthDay(monthDayMatch[1], monthDayMatch[2]);

    return text;
  }

  function offsetDate(daysAgo) {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return date;
  }

  function formatDateFromDate(date) {
    return formatDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  function formatMonthDay(month, day) {
    const now = new Date();
    let year = now.getFullYear();
    const parsed = new Date(year, Number(month) - 1, Number(day));

    // 招聘站点不带年份的日期通常指最近一次更新；如果月日落在未来，则归到上一年。
    if (parsed.getTime() > now.getTime()) year -= 1;

    return formatDate(year, month, day);
  }

  function formatDate(year, month, day) {
    const normalizedYear = String(year).padStart(4, "0");
    const normalizedMonth = String(month).padStart(2, "0");
    const normalizedDay = String(day).padStart(2, "0");
    return `${normalizedYear}-${normalizedMonth}-${normalizedDay}`;
  }

  function currentSourceSite() {
    // 来源网站只由域名判断，避免页面标题或 DOM 文案变化影响导出结果。
    if (/zhipin\.com/i.test(location.hostname)) return "boss直聘";
    if (/(^|\.)zhaopin\.com$/i.test(location.hostname)) return "智联招聘";
    if (/(^|\.)liepin\.com$/i.test(location.hostname)) return "猎聘";
    return "";
  }

  function isSupportedSite() {
    // 保存数据前必须命中已适配站点，避免普通网页或招聘列表页产生无效记录。
    return Boolean(currentSourceSite());
  }

  // 从任意文本里抠出薪资短字段，例如 25-30K、40-70K·20薪、面议。
  // 这个函数既用于字段提取，也用于过滤误识别的公司名/标题。
  function findSalaryByPattern(text) {
    const matches = cleanText(text).match(/面议|\b\d+(?:\.\d+)?\s*[-~到]\s*\d+(?:\.\d+)?\s*[Kk千万][^,\n，。；; ]{0,8}|\b\d+(?:\.\d+)?\s*[Kk千万][^,\n，。；; ]{0,8}/g);
    return matches ? cleanText(matches[0]) : "";
  }

  function normalizeSalary(value) {
    // 专用 selector 取到的薪资也统一过一遍，保证“面议”和数字薪资格式一致。
    const text = cleanText(value);
    return findSalaryByPattern(text) || text;
  }

  // 经验和学历有时在独立标签里，有时只存在整页文本中。
  // BOSS 专用路径优先取 tag-list，正则只作为缺失时的补充。
  function findExperienceByPattern(text) {
    const match = cleanText(text).match(EXPERIENCE_PATTERN);
    return match ? cleanText(match[0]) : "";
  }

  function findEducationByPattern(text) {
    const match = cleanText(text).match(EDUCATION_PATTERN);
    return match ? cleanText(match[0]) : "";
  }

  // 一些页面会把标题和薪资放在同一个容器甚至同一段文本里。
  // 导出岗位名称前要剔除薪资行，避免出现“产品经理\n25-30K”。
  function cleanTitle(title, salary) {
    const salaryText = cleanText(salary);
    return cleanText(title)
      .split("\n")
      .map((line) => cleanText(line.replace(salaryText, "")))
      .filter((line) => line && !findSalaryByPattern(line))
      .join("\n");
  }

  // BOSS 搜索列表右侧详情页的稳定结构来自实际页面结构：
  // - 详情卡片：.job-detail-container .job-detail-box
  // - 标题/薪资：.job-detail-header .job-detail-info
  // - 经验/学历：.job-detail-header .tag-list li
  // - JD 正文：.job-detail-body > p.desc
  // - 公司名/地点：右侧详情不够稳定，需要用当前 jobId 回到左侧职位卡片取 .boss-name/.company-location
  function extractZhipinJob() {
    if (!/zhipin\.com/i.test(location.hostname)) return null;

    // BOSS 搜索页右侧详情面板加载完成后会出现这个容器。
    // 如果用户还停留在列表加载态，或者页面结构换了，这里返回 null 并提示用户核对页面。
    const detailBox = document.querySelector(".job-detail-container .job-detail-box");
    if (!detailBox) return null;

    // 右侧详情头部只包含当前选中职位，不会混入左侧列表的其他岗位。
    const salary = normalizeSalary(firstText([
      ".job-detail-header .job-detail-info .job-salary"
    ], detailBox));
    const title = cleanTitle(firstText([
      ".job-detail-header .job-detail-info .job-name"
    ], detailBox), salary);
    const tags = Array.from(detailBox.querySelectorAll(".job-detail-header .tag-list li"))
      .map((node) => cleanText(node.innerText))
      .filter(Boolean);

    // BOSS 正文实际落在 p.desc 里，后面的 .job-boss-info 和 .job-address
    // 是同级后续模块，所以这里直接取 p.desc，不再从 job-detail-body 整块取文本。
    const description = extractZhipinDescription(detailBox);

    // 右侧详情没有稳定的公司和地点字段。more-job-btn 的 href 带有当前职位 jobId，
    // 再用这个 jobId 回到左侧对应职位卡片，才能取到同一职位的公司名和 company-location。
    const jobId = findZhipinDetailJobId(detailBox);
    const cardInfo = findZhipinCardInfoByJobId(jobId);

    return {
      ...EMPTY_JOB,
      title,
      company: cardInfo.company,
      location: cardInfo.location || tags[0] || "",
      experience: tags[1] || findExperienceByPattern(tags.join("\n")),
      education: tags[2] || findEducationByPattern(tags.join("\n")),
      salary,
      description,
      sourceSite: "boss直聘",
      sourceUrl: location.href
    };
  }

  function extractZhipinDescription(detailBox) {
    const direct = firstText([
      ".job-detail-body > p.desc",
      ".job-detail-body p.desc",
      ".job-detail-body .job-description",
      ".job-detail-body [class*='job-description']"
    ], detailBox);
    if (direct) return direct;

    // BOSS 灰度页面会保留 job-detail-body，但给正文段落更换 class 或增加包装层。
    // 此时只在当前详情正文区域的 p 中选择最长段落，避免读取 HR 信息或工作地址短文本。
    const paragraphs = Array.from(detailBox.querySelectorAll(".job-detail-body p"))
      .map((node) => textOf(node))
      .filter((text) => text.length >= 20 && !/^工作地址/.test(text));
    return paragraphs.sort((left, right) => right.length - left.length)[0] || "";
  }

  function findZhipinDetailJobId(detailBox) {
    // BOSS 右侧详情底部“查看更多信息”链接包含 /job_detail/{jobId}.html。
    // 这个 id 与左侧列表卡片里的职位链接一致，是左右区域建立关系的关键。
    const link = detailBox.querySelector(".job-detail-body a.more-job-btn[href*='/job_detail/']");
    const href = link && link.getAttribute("href");
    const match = String(href || "").match(/\/job_detail\/([^.?/]+)/);
    return match ? match[1] : "";
  }

  function findZhipinCardInfoByJobId(jobId) {
    const empty = { company: "", location: "" };
    if (!jobId) return empty;

    // 左侧列表中每个职位卡片都有 a.job-name。先通过 jobId 找到当前选中的卡片，
    // 再从卡片 footer 读取公司简称和地点。避免误取右侧 Boss 姓名/职位或详情页地址。
    const jobLink = Array.from(document.querySelectorAll(".job-card-box a.job-name[href*='/job_detail/']")).find((node) => {
      return String(node.getAttribute("href") || "").includes(`/job_detail/${jobId}`);
    });
    const card = jobLink && jobLink.closest(".job-card-box");
    const companyNode = card && card.querySelector(".job-card-footer .boss-name");
    const locationNode = card && card.querySelector(".job-card-footer .company-location");

    return {
      company: cleanCompanyName(textOf(companyNode)),
      location: cleanText(textOf(locationNode))
    };
  }

  function cleanCompanyName(value) {
    const text = cleanText(value);
    const invalid = ["公司", "公司名称", "企业", "企业名称", "公司介绍", "工商信息"];

    // 公司名提取宁可为空，也不要把字段标题、薪资、经验学历或 HR 信息写进 Excel。
    if (!text || invalid.includes(text)) return "";
    if (findSalaryByPattern(text) || findExperienceByPattern(text) || findEducationByPattern(text)) return "";
    if (/招聘专家|招聘经理|猎头顾问|HR|人事|在线|活跃/.test(text)) return "";

    return text;
  }

  function extractLiepinCompany() {
    const titleBoxText = firstText([".title-box"]);

    // 猎聘猎头/外包招聘职位的 title-box 会带这些角色或机构字样，导出时统一标记为猎头直招。
    if (/猎头|顾问|招聘专员|人力资源/.test(titleBoxText)) return "猎头直招";

    return cleanCompanyName(firstText([
      ".company-info-container .company-card .content .name.ellipsis-1"
    ]));
  }

  // 智联的搜索、推荐和职位分类入口共用新版 job-detail-* 详情结构。
  // 搜索/推荐页同时存在左侧职位列表，因此必须先锁定右侧详情面板，避免提取到其他岗位。
  // 旧版 summary-planes-* 选择器继续作为兼容回退。
  function extractZhaopinJob() {
    if (!/(^|\.)zhaopin\.com$/i.test(location.hostname)) return null;

    const detailRoot = document.querySelector(".job-split-layout__right .job-detail-panel")
      || document.querySelector(".job-detail-panel")
      || document;
    const salary = normalizeSalary(firstText([
      ".job-detail-summary__salary",
      ".summary-planes__salary"
    ], detailRoot));
    const title = firstText([
      ".job-detail-summary__title-text",
      ".summary-planes__title span"
    ], detailRoot);
    const tags = Array.from(detailRoot.querySelectorAll(".job-detail-summary__tags .job-detail-summary__tag"))
      .map((node) => textOf(node.querySelector("span") || node))
      .filter(Boolean);
    const job = {
      ...EMPTY_JOB,
      title: cleanTitle(title, salary),
      company: cleanCompanyName(firstText([
        ".job-detail-summary__company-name",
        ".company-summary__name-link"
      ], detailRoot)),
      location: tags[0] || childText(".summary-planes__info li", 0, detailRoot),
      experience: tags[1] || childText(".summary-planes__info li", 1, detailRoot),
      education: tags[2] || childText(".summary-planes__info li", 2, detailRoot),
      salary,
      description: firstText([
        ".job-description__content",
        ".describtion-card__detail-content"
      ], detailRoot),
      postedDate: normalizePostedDate(firstText([".summary-planes__time"], detailRoot)),
      sourceSite: "智联招聘",
      sourceUrl: location.href
    };

    // 保留部分提取结果交给统一校验判断“仍在加载”，但校验失败时不会写入岗位池。
    return job;
  }

  // 猎聘详情页字段都在固定模块内；split span 也占位，所以按用户标注的 span 序号取值。
  function extractLiepinJob() {
    if (!/(^|\.)liepin\.com$/i.test(location.hostname)) return null;

    const title = firstText([".job-title.ellipsis-2"]);
    const salary = normalizeSalary(firstText([".salary"]));
    const job = {
      ...EMPTY_JOB,
      title: cleanTitle(title, salary),
      company: extractLiepinCompany(),
      location: childText(".job-properties span", 0),
      experience: childText(".job-properties span", 2),
      education: childText(".job-properties span", 4),
      salary,
      description: firstText(["[data-selector='job-intro-content']"]),
      postedDate: normalizePostedDate(lastChildText(".job-properties span")),
      sourceSite: "猎聘",
      sourceUrl: location.href
    };

    // 保留部分提取结果交给统一校验判断“仍在加载”，但校验失败时不会写入岗位池。
    return job;
  }

  function extractJob() {
    // 已支持站点只走对应专用结构，避免在列表页、首页或普通网页误保存假 JD。
    if (/zhipin\.com/i.test(location.hostname)) return extractZhipinJob();
    if (/(^|\.)zhaopin\.com$/i.test(location.hostname)) return extractZhaopinJob();
    if (/(^|\.)liepin\.com$/i.test(location.hostname)) return extractLiepinJob();
    return null;
  }

  function detectBlockedPageMessage() {
    // 仅使用明确的整页状态文案；不匹配普通导航中的“登录/注册”，避免误伤正常职位页。
    const pageText = cleanText(`${document.title || ""}\n${textOf(document.body)}`);

    if (/Security Verification|正在验证连接安全性|安全验证|请完成验证|滑动验证|验证后继续/i.test(pageText)) {
      return "招聘网站正在进行安全验证，请先在网页完成验证后再提取";
    }

    if (/该职位已暂停招聘|职位已暂停|职位已下线|岗位已下线|职位已关闭|岗位已关闭|职位不存在|岗位不存在|已停止招聘/.test(pageText)) {
      return "当前岗位已暂停或下线，请更换有效岗位后再提取";
    }

    if (/请(?:先)?登录|登录后(?:可|才能|查看)|登录状态.*失效|登录已过期|请重新登录/.test(pageText)) {
      return "当前登录状态已失效，请先在招聘网站重新登录后再提取";
    }

    return "";
  }

  function validateJob(job) {
    // 异常页面兜底：非支持站点或非 JD 详情页不写入本地列表。
    if (!isSupportedSite()) {
      return {
        ok: false,
        message: "当前页面不是已支持的招聘网站"
      };
    }

    const blockedPageMessage = detectBlockedPageMessage();
    if (blockedPageMessage) {
      return { ok: false, message: blockedPageMessage };
    }

    if (!job || (!job.title && !job.description)) {
      return {
        ok: false,
        message: "当前页面不像岗位详情页，请进入职位详情页后再提取"
      };
    }

    if (!job.title || !job.description) {
      return {
        ok: false,
        message: "未读取到完整岗位信息，请确认标题和岗位描述已经显示后重试"
      };
    }

    return { ok: true };
  }

  function extractJobResponse() {
    // content script 统一返回 ok/message/job，popup 只负责展示结果或错误。
    const job = extractJob();
    const validation = validateJob(job);

    if (!validation.ok) {
      return { ok: false, message: validation.message, job };
    }

    return { ok: true, job };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    // 侧边栏面板通过消息调用页面提取。这里同步返回即可，因为所有读取都来自当前 DOM。
    if (message && message.type === "ROLEMI_EXTRACT") {
      sendResponse(extractJobResponse());
    }
  });
})();
