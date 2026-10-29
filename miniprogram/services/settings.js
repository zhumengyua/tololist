// services/settings.js —— 个人默认费用参数（本地存储版）
const { get, set } = require('../utils/storage');
const { DEFAULT_FEES } = require('../utils/fee');

const SET_KEY = 'stock_settings';

// 读取：无则用默认值
function getSettings() {
  const s = get(SET_KEY, {});
  return Object.assign({}, DEFAULT_FEES, s);
}

// 保存
function saveSettings(cfg) {
  const data = {
    commissionRate: Number(cfg.commissionRate),
    minCommission: Number(cfg.minCommission),
    stampTax: Number(cfg.stampTax),
    transferFee: Number(cfg.transferFee),
    updatedAt: Date.now()
  };
  set(SET_KEY, data);
  return data;
}

module.exports = {
  getSettings,
  saveSettings
};
