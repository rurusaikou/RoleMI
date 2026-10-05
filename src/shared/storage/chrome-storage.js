/**
 * 存储适配层：包装 Chrome 回调 API 与 local / session 读写。
 * 普通网页预览使用 Web Storage 回退，扩展内优先使用 Chrome 存储。
 */
export function chromeAsync(fn) {
  return new Promise((resolve, reject) => {
    fn((result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result);
    });
  });
}

// 扩展运行时使用 Chrome 存储；普通网页预览才回退到 Web Storage。
export async function getLocal(defaults) {
  const keys = Object.keys(defaults);
  if (window.chrome && chrome.storage && chrome.storage.local) {
    return chromeAsync((done) => chrome.storage.local.get(defaults, done));
  }

  return keys.reduce((data, key) => {
    try {
      data[key] = JSON.parse(localStorage.getItem(key)) || defaults[key];
    } catch (_error) {
      data[key] = defaults[key];
    }
    return data;
  }, {});
}

export async function setLocal(data) {
  if (window.chrome && chrome.storage && chrome.storage.local) {
    await chromeAsync((done) => chrome.storage.local.set(data, done));
    return;
  }

  Object.entries(data).forEach(([key, value]) => {
    localStorage.setItem(key, JSON.stringify(value));
  });
}

// API Key 使用会话存储；网页回退的 sessionStorage 生命周期与扩展会话不同。
export async function getSession(defaults) {
  const keys = Object.keys(defaults);
  if (window.chrome && chrome.storage && chrome.storage.session) {
    return chromeAsync((done) => chrome.storage.session.get(defaults, done));
  }

  return keys.reduce((data, key) => {
    try {
      data[key] = JSON.parse(sessionStorage.getItem(key)) || defaults[key];
    } catch (_error) {
      data[key] = defaults[key];
    }
    return data;
  }, {});
}

export async function setSession(data) {
  if (window.chrome && chrome.storage && chrome.storage.session) {
    await chromeAsync((done) => chrome.storage.session.set(data, done));
    return;
  }

  Object.entries(data).forEach(([key, value]) => {
    sessionStorage.setItem(key, JSON.stringify(value));
  });
}
