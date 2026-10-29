// 卖出页（普通卖出 + 做T指定批次）
const { listHoldings, listBatches, doSell, doSellSelected } = require('../../services/positions');
const { getSettings } = require('../../services/settings');
const { calcSellProfit, calcSell } = require('../../utils/calc');
const { fmtMoney, fmtHands, fmtNum, fmtRate } = require('../../utils/format');
const { sanitizeInt, sanitizeNum } = require('../../utils/input');

function today() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const EMPTY_PREVIEW = {
  sharesText: '',
  sellNet: '0.00',
  sellFee: '0.00',
  allocatedCost: '0.00',
  profitNum: 0,
  profit: '0.00',
  profitRate: '0.00%'
};

Page({
  data: {
    stockOptions: [],
    stockIndex: 0,
    selected: { name: '', code: '', available: 0 },
    batches: [],
    batchItems: [], // 做T模式：可勾选的买入批次（含勾选态/各自卖出量）
    numStr: '',
    priceStr: '',
    sellDate: today(),
    feeCfg: {},
    clearing: false, // 清仓态：数量=全部可卖（可能含零股非整手）
    activeTab: 0, // 0=整仓卖出 1=单笔持仓(买入记录勾选批量卖出)
    preview: Object.assign({}, EMPTY_PREVIEW, { profit: '0.00', profitRate: '0.00%' }),
    showProfit: false, // 确认卖出弹窗
    profitDlg: {}
  },

  async onLoad(query) {
    try {
      // getSettings 为同步函数，直接取；listHoldings 为 async，用 .catch 兜底
      const settings = getSettings();
      const options = await listHoldings().catch(() => []);
      const stockOptions = options.map(h => ({
        code: h.code,
        name: h.name,
        available: h.held,
        label: `${h.name} ${h.code}`
      }));
      let index = 0;
      if (query.code) {
        const i = stockOptions.findIndex(o => o.code === query.code);
        if (i >= 0) index = i;
      }
      this.setData({ feeCfg: settings, stockOptions });
      this.selectStock(index);
    } catch (e) {
      wx.showToast({ title: '加载持仓失败', icon: 'none' });
    }
  },

  async selectStock(index) {
    const { stockOptions } = this.data;
    if (!stockOptions.length) {
      this.setData({ selected: { name: '', code: '', available: 0, availableHand: '0' }, batches: [], preview: EMPTY_PREVIEW });
      return;
    }
    const sel = stockOptions[index];
    this.setData({
      stockIndex: index,
      selected: {
        name: sel.name,
        code: sel.code,
        available: sel.available, // 股
        availableHand: fmtHands(sel.available)
      },
      batches: [],
      batchItems: [],
      clearing: false,
      activeTab: 0
    });
    // 取批次：普通模式算 FIFO 成本，做T模式生成可勾选批次
    try {
      const batches = await listBatches(sel.code);
      const batchItems = batches
        .filter(b => b.remain > 0)
        .map(b => ({
          id: b.id,
          buyTime: b.buyTime,
          buyPriceText: fmtMoney(b.buyPrice),
          remain: b.remain,
          remainHand: fmtHands(b.remain),
          checked: false,
          sellHandsStr: '' // 勾选后填本笔要卖的手数
        }));
      this.setData({ batches, batchItems });
    } catch (e) {
      wx.showToast({ title: '读取批次失败', icon: 'none' });
    }
    this.refreshPreview();
  },

  onPickStock(e) {
    this.selectStock(Number(e.detail.value));
  },

  // 切换 tab：0整仓卖出 / 1单笔持仓
  onTabChange(e) {
    this.setData({ activeTab: e.detail.index, clearing: false });
  },

  // 勾选/取消某个买入批次（做T）
  onToggleBatch(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.batchItems.map(b => {
      if (b.id !== id) return b;
      const checked = !b.checked;
      return Object.assign({}, b, {
        checked,
        // 勾上时默认填该批剩余量，取消则清空
        sellHandsStr: checked ? b.remainHand : ''
      });
    });
    this.setData({ batchItems: list });
  },

  // 做T：每笔勾选批次的卖出量
  onBatchInput(e) {
    const id = e.currentTarget.dataset.id;
    const val = sanitizeInt(e.detail.value);
    const list = this.data.batchItems.map(b => (b.id === id ? Object.assign({}, b, { sellHandsStr: val }) : b));
    this.setData({ batchItems: list });
  },

  noop() {},

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    let val = e.detail.value;
    // 数值字段过滤：手数为正整数，价格为正小数(2位)
    if (field === 'num') val = sanitizeInt(val);
    else if (field === 'price') val = sanitizeNum(val);
    // 手动改数量即退出清仓态（回到普通卖出）
    this.setData({ [field + 'Str']: val, clearing: false });
    this.refreshPreview();
  },

  // 清仓：数量自动填为全部可卖（含零股，一次性卖出）
  onClear() {
    const { available, availableHand } = this.data.selected;
    if (!available || available <= 0) return wx.showToast({ title: '该股票无可卖持仓', icon: 'none' });
    this.setData({ numStr: availableHand, clearing: true });
    this.refreshPreview();
  },

  onDate(e) {
    this.setData({ sellDate: e.detail.value });
  },

  refreshPreview() {
    const { clearing, selected, batches, numStr, priceStr, feeCfg } = this.data;
    const price = parseFloat(priceStr);
    // 清仓态直接取全部可卖股数；否则按手数×100
    const shares = clearing ? selected.available : (parseInt(numStr, 10) || 0) * 100;
    if (!shares || shares <= 0 || !price || price <= 0 || !batches.length) {
      this.setData({ preview: EMPTY_PREVIEW });
      return;
    }
    const r = calcSellProfit(shares, price, batches, feeCfg);
    this.setData({
      preview: {
        sharesText: fmtNum(shares) + ' 股',
        sellNet: fmtMoney(r.sellNet),
        sellFee: fmtMoney(r.sellFee),
        allocatedCost: fmtMoney(r.allocatedCost),
        profitNum: r.profit,
        profit: (r.profit >= 0 ? '+' : '') + fmtMoney(r.profit),
        profitRate: fmtRate(r.profitRate)
      }
    });
  },

  // 整仓卖出：校验 → 计算盈亏并弹确认窗（不直接执行）
  onSave() {
    const { selected, numStr, priceStr, sellDate, clearing, feeCfg, batches } = this.data;
    const price = parseFloat(priceStr);
    // 清仓态卖全部可卖股数（允许零股）；否则按手数×100
    const shares = clearing ? selected.available : (parseInt(numStr, 10) || 0) * 100;
    const hands = shares / 100;

    if (!selected.name) return wx.showToast({ title: '请选择股票', icon: 'none' });
    if (!shares || shares <= 0) return wx.showToast({ title: '请填写卖出数量', icon: 'none' });
    if (!clearing && !Number.isInteger(hands)) return wx.showToast({ title: '卖出需为整手数(>=1手)', icon: 'none' });
    if (shares > selected.available) return wx.showToast({ title: '超过可卖持仓', icon: 'none' });
    if (!price || price <= 0) return wx.showToast({ title: '卖出价需大于0', icon: 'none' });

    // FIFO 模拟：与提交后的 doSell 一致——按最早买入批次优先消耗，每笔单独算盈亏
    const ordered = batches
      .slice()
      .sort((a, b) => (a.buyTime || a.createdAt || 0) - (b.buyTime || b.createdAt || 0));
    let remain = shares;
    const lines = [];
    let totalNet = 0, totalFee = 0, totalCost = 0;
    for (const doc of ordered) {
      if (remain <= 0) break;
      const rem = doc.buyNum - (doc.soldNum || 0);
      if (rem <= 0) continue;
      const take = Math.min(rem, remain);
      remain -= take;
      const sell = calcSell(take, price, feeCfg);
      const batchTotalCost = doc.buyPrice * doc.buyNum + (doc.buyFee || 0);
      const cost = batchTotalCost * (take / doc.buyNum);
      const profit = sell.net - cost;
      totalNet += sell.net;
      totalFee += sell.fee;
      totalCost += cost;
      lines.push({
        time: doc.buyTime,
        price: fmtMoney(doc.buyPrice),
        hands: fmtHands(take),
        sellNet: fmtMoney(sell.net),
        profit: (profit >= 0 ? '+' : '') + fmtMoney(profit),
        cls: profit >= 0 ? 'up' : 'down'
      });
    }
    const totalProfit = totalNet - totalCost;

    this._pending = {
      type: 'whole',
      code: selected.code,
      name: selected.name,
      num: shares,
      price,
      time: sellDate
    };
    this.setData({
      showProfit: true,
      profitDlg: {
        mode: 'split',
        title: `确认卖出 · 成交价 ${priceStr} 元`,
        lines,
        sellNet: fmtMoney(totalNet),
        sellFee: fmtMoney(totalFee),
        allocatedCost: fmtMoney(totalCost),
        profit: (totalProfit >= 0 ? '+' : '') + fmtMoney(totalProfit),
        profitRate: fmtRate(totalCost > 0 ? totalProfit / totalCost : 0),
        cls: totalProfit >= 0 ? 'up' : 'down',
        itemCount: lines.length,
        subTip: '按最早买入优先消耗，每笔单独记录收益'
      }
    });
  },

  // 做T：按勾选的指定批次分开卖出、分开记盈亏（先弹确认窗）
  onSaveTplus() {
    const { selected, batchItems, priceStr, sellDate, feeCfg, batches } = this.data;
    const price = parseFloat(priceStr);
    if (!selected.name) return wx.showToast({ title: '请选择股票', icon: 'none' });
    if (!price || price <= 0) return wx.showToast({ title: '卖出价需大于0', icon: 'none' });

    const picked = batchItems.filter(b => b.checked);
    if (!picked.length) return wx.showToast({ title: '请先勾选要卖出的买入批次', icon: 'none' });

    const items = [];
    const lines = [];
    let totalNet = 0;
    let totalFee = 0;
    let totalCost = 0;

    for (const b of picked) {
      const hands = parseInt(b.sellHandsStr, 10);
      const shares = (hands || 0) * 100;
      if (!shares || shares <= 0) return wx.showToast({ title: '请为勾选的批次填写卖出数量', icon: 'none' });
      if (shares > b.remain) return wx.showToast({ title: '某批次卖出数量超过该笔剩余持仓', icon: 'none' });
      const doc = batches.find(x => x.id === b.id);
      if (!doc) return wx.showToast({ title: '批次不存在', icon: 'none' });

      const sell = calcSell(shares, price, feeCfg);
      // 该笔对应买入成本（按数量比例分摊含买入费的总成本）
      const batchTotalCost = doc.buyPrice * doc.buyNum + (doc.buyFee || 0);
      const cost = batchTotalCost * (shares / doc.buyNum);
      const profit = sell.net - cost;

      items.push({ batchId: b.id, num: shares });
      totalNet += sell.net;
      totalFee += sell.fee;
      totalCost += cost;
      lines.push({
        time: doc.buyTime,
        price: fmtMoney(doc.buyPrice),
        hands: fmtHands(shares),
        sellNet: fmtMoney(sell.net),
        profit: (profit >= 0 ? '+' : '') + fmtMoney(profit),
        cls: profit >= 0 ? 'up' : 'down'
      });
    }

    const totalProfit = totalNet - totalCost;
    this._pending = {
      type: 'tplus',
      code: selected.code,
      name: selected.name,
      price,
      time: sellDate,
      items
    };
    this.setData({
      showProfit: true,
      profitDlg: {
        mode: 'tplus',
        title: `确认批量卖出 · 成交价 ${priceStr} 元`,
        lines,
        sellNet: fmtMoney(totalNet),
        sellFee: fmtMoney(totalFee),
        allocatedCost: fmtMoney(totalCost),
        profit: (totalProfit >= 0 ? '+' : '') + fmtMoney(totalProfit),
        profitRate: fmtRate(totalCost > 0 ? totalProfit / totalCost : 0),
        cls: totalProfit >= 0 ? 'up' : 'down',
        itemCount: items.length,
        subTip: '每笔勾选持仓单独记录收益'
      }
    });
  },

  // 弹窗确认：真正执行卖出
  async onProfitConfirm() {
    const p = this._pending;
    this.setData({ showProfit: false });
    if (!p) return;
    this._pending = null;
    const feeCfg = this.data.feeCfg;

    if (p.type === 'whole') {
      wx.showLoading({ title: '卖出中' });
      try {
        await doSell({ code: p.code, name: p.name, num: p.num, price: p.price, time: p.time, feeCfg });
        wx.hideLoading();
        wx.showToast({ title: '卖出成功', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      } catch (err) {
        wx.hideLoading();
        wx.showToast({ title: err.message || '卖出失败', icon: 'none' });
      }
    } else {
      wx.showLoading({ title: '卖出中' });
      try {
        await doSellSelected({ code: p.code, name: p.name, price: p.price, time: p.time, feeCfg, items: p.items });
        wx.hideLoading();
        wx.showToast({ title: `已按 ${p.items.length} 笔分开记录`, icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      } catch (err) {
        wx.hideLoading();
        wx.showToast({ title: err.message || '卖出失败', icon: 'none' });
      }
    }
  },

  onProfitCancel() {
    this._pending = null;
    this.setData({ showProfit: false });
  }
});
