// services/backup.js —— 本地数据导出 / 导入（JSON 备份）
const { get, set } = require('../utils/storage');

const POS_KEY = 'stock_positions';
const REC_KEY = 'stock_records';
const SET_KEY = 'stock_settings';

const APP_TAG = 'stock-ledger';

/** 导出为 JSON 字符串（可通过剪贴板/文件保存） */
function exportBackup() {
  return JSON.stringify({
    app: APP_TAG,
    version: 1,
    exportedAt: Date.now(),
    positions: get(POS_KEY, []),
    records: get(REC_KEY, []),
    settings: get(SET_KEY, {})
  });
}

/** 导入并覆盖本地数据，返回统计 */
function importBackup(str) {
  const data = JSON.parse(str);
  if (!data || data.app !== APP_TAG) {
    throw new Error('不是本应用的备份内容');
  }
  const positions = Array.isArray(data.positions) ? data.positions : [];
  const records = Array.isArray(data.records) ? data.records : [];
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {};

  set(POS_KEY, positions);
  set(REC_KEY, records);
  set(SET_KEY, settings);
  return { positions: positions.length, records: records.length };
}

module.exports = { exportBackup, importBackup };
