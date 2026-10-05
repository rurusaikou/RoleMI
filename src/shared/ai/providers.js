/**
 * 实际模型供应商预设表；托管/自定义属于 mode，不在此表表达。
 */
export const apiProviderPresets = {
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini"
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash"
  }
};
