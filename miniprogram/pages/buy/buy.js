// 买入页（含补仓）
const { doBuy, listStockStats } = require('../../services/positions');
const { getSettings } = require('../../services/settings');
const { calcBuy } = require('../../utils/calc');
const { fmtMoney, fmtRate, fmtNum } = require('../../utils/format');
const { sanitizeInt, sanitizeNum } = require('../../utils/input');

function today() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

Page({
  data: {
    name: '',
    code: '',
    numStr: '',
    priceStr: '',
    buyDate: today(),
    feeCfg: {},
    isAdd: false, // 补仓模式：名称/代码不可改，并展示补仓后收益预览
    cur: null,    // 当前该股票持仓 { held, avgCost, totalCost }
    curPriceStr: '', // 估算用的当前价
    preview: { amount: '0.00', fee: '0.00', totalCost: '0.00' },
    addPreview: null // 补仓后摊薄成本/浮动收益/收益率
  },

  async onLoad(query) {
    // 支持从「持仓-补仓」进入：预填该股票，且名称/代码锁定
    // 用显式 add=1 标记识别补仓（代码可能为空串，不能以 code 是否有值判断）
    if (query && query.add) {
      const code = query.code || '';
      const name = decodeURIComponent(query.name || '');
      this.setData({ code, name, isAdd: true });
      try {
        const stats = await listStockStats();
        // 有代码按代码匹配；无代码按名称匹配
        const cur = stats.find(s =>
          (code ? s.code === code : s.name === name) && s.held > 0);
        if (cur) {
          this.setData({
            cur: { held: cur.held, avgCost: cur.avgCost, totalCost: cur.totalCost },
            curPriceStr: cur.avgCost.toFixed(2)
          });
        }
      } catch (e) { /* 无当前持仓也允许正常补仓 */ }
    }
    try {
      const feeCfg = await getSettings();
      this.setData({ feeCfg });
    } catch (e) {
      wx.showToast({ title: '读取费用参数失败', icon: 'none' });
    }
  },

  // 字段→data 键映射：name/code 直接存字符串字段，num/price/curPrice 存带 Str 后缀的字符串
  onInput(e) {
    const field = e.currentTarget.dataset.field;
    const keyMap = { name: 'name', code: 'code', num: 'numStr', price: 'priceStr', curPrice: 'curPriceStr' };
    let val = e.detail.value;
    // 数值字段过滤：手数为正整数，价格类为正小数(2位)
    if (field === 'num') val = sanitizeInt(val);
    else if (field === 'price' || field === 'curPrice') val = sanitizeNum(val);
    this.setData({ [keyMap[field] || field]: val });
    this.refreshPreview();
  },

  onDate(e) {
    this.setData({ buyDate: e.detail.value });
  },

  refreshPreview() {
    const hands = parseInt(this.data.numStr, 10); // 手
    const price = parseFloat(this.data.priceStr);
    const shares = hands * 100;
    const hasBuy = hands && price && hands > 0 && price > 0;

    let preview = { amount: '0.00', fee: '0.00', totalCost: '0.00', totalCostNum: 0 };
    if (hasBuy) {
      const r = calcBuy(shares, price, this.data.feeCfg);
      preview = {
        amount: fmtMoney(r.amount),
        fee: fmtMoney(r.fee),
        totalCost: fmtMoney(r.totalCost),
        totalCostNum: r.totalCost
      };
    }

    // 补仓：按移动加权预览补仓后的摊薄成本、浮动收益、收益率（需参考现价估算）
    let addPreview = null;
    if (this.data.isAdd && this.data.cur) {
      const cur = this.data.cur;
      const curPrice = parseFloat(this.data.curPriceStr);
      const usePrice = curPrice && curPrice > 0 ? curPrice : cur.avgCost;
      let newAvg = cur.avgCost;
      let newProfit = 0;
      let newRate = 0;
      if (hasBuy) {
        newAvg = (cur.totalCost + preview.totalCostNum) / (cur.held + shares);
        newProfit = (usePrice - newAvg) * (cur.held + shares);
        newRate = newAvg > 0 ? (usePrice - newAvg) / newAvg : 0;
      }
      addPreview = {
        curHeldText: fmtNum(cur.held),
        curAvgCost: fmtMoney(cur.avgCost),
        newAvgCost: hasBuy ? fmtMoney(newAvg) : '—',
        newProfit: hasBuy ? fmtMoney(newProfit) : '—',
        newRate: hasBuy ? fmtRate(newRate) : '—',
        cls: newProfit >= 0 ? 'up' : 'down'
      };
    }

    this.setData({ preview, addPreview });
  },

  async onSave() {
    const { name, code, numStr, priceStr, buyDate } = this.data;
    const hands = parseInt(numStr, 10);
    const price = parseFloat(priceStr);

    if (!name.trim()) return wx.showToast({ title: '请填写股票名称', icon: 'none' });
    if (!hands || hands <= 0 || !Number.isInteger(hands)) return wx.showToast({ title: '买入需为整手数(>=1手)', icon: 'none' });
    if (!price || price <= 0) return wx.showToast({ title: '成交价需大于0', icon: 'none' });

    wx.showLoading({ title: '保存中' });
    try {
      await doBuy({
        code: code.trim(),
        name: name.trim(),
        buyNum: hands * 100, // 股
        buyPrice: price,
        buyTime: buyDate,
        feeCfg: this.data.feeCfg
      });
      wx.hideLoading();
      wx.showToast({ title: '已记入持仓', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  }
});
