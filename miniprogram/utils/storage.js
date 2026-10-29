// utils/storage.js —— 本地存储封装（wx.storage）
function get(key, def) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v == null ? def : v;
  } catch (e) {
    return def;
  }
}

function set(key, val) {
  wx.setStorageSync(key, val);
}

function remove(key) {
  try {
    wx.removeStorageSync(key);
  } catch (e) {
    // ignore
  }
}

module.exports = { get, set, remove };
