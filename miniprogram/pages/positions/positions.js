// 持仓列表（个股汇总统计：持仓 Tab + 清仓 Tab）
const { listStockStats, removeStock, listSells } = require('../../services/positions');
const { fmtMoney, fmtRate, fmtHands, fmtAmount } = require('../../utils/format');

Page({
  data: {
    activeTab: 0, // 0=持仓 1=清仓
    holdings: [],
    totalCost: '0.00',
    totalHeld: '0',
    closed: [], // 已清仓（全部卖出）的股票
    closedCount: '0',
    closedRealized: '0.00',
    closedRealizedCls: 'up',
    loading: true,
    DEL_W: 96 // 左滑删除按钮宽度(px)，传给 Vant SwipeCell 的 right-width
  },

  onShow() {
    this.load();
  },

  async load() {
    this.setData({ loading: true });
    try {
      const all = await listStockStats();
      // 持仓：仍持有不止 0 股
      const holdingList = all.filter(h => h.held > 0);
      // 清仓：曾买过、现已全部卖出（held<=0）
      const closedList = all.filter(h => h.held <= 0 && h.buyCount > 0);

      const totalCost = holdingList.reduce((s, h) => s + h.totalCost, 0);
      const totalHeld = holdingList.reduce((s, h) => s + h.held, 0);

      const closedRealized = closedList.reduce((s, h) => s + (h.realizedNet || 0), 0);

      this.setData({
        holdings: holdingList.map(h => {
          const pn = h.totalProfit;
          return {
            code: h.code,
            name: h.name,
            held: fmtHands(h.held),
            buyCount: h.buyCount,
            avgCost: fmtMoney(h.avgCost),
            buyCost: fmtAmount(h.buyCostTotal),
            netInvest: fmtAmount(h.netInvest),
            buyHands: fmtHands(h.buySharesTotal),
            sellHands: fmtHands(h.sellSharesTotal),
            realized: fmtMoney(h.realizedNet),
            hh: pn,
            totalProfit: fmtMoney(pn),
            totalRate: fmtRate(h.totalRate),
            cls: pn >= 0 ? 'up' : 'down'
          };
        }),
        totalCost: fmtMoney(totalCost),
        totalHeld: fmtHands(totalHeld),

        closed: await Promise.all(closedList.map(async c => {
          const sells = (await listSells(c.code)).map(s => ({
            id: s.id,
            time: s.time,
            numText: fmtHands(s.num),
            price: fmtMoney(s.price),
            fee: fmtMoney(s.fee || 0),
            profit: fmtMoney(s.profit),
            rate: fmtRate(s.profitRate),
            cls: s.profit >= 0 ? 'up' : 'down'
          }));
          return {
            code: c.code,
            name: c.name,
            buyCount: c.buyCount,
            realized: fmtMoney(c.realizedNet),
            realizedRate: fmtRate(c.realizedRate),
            buyHands: fmtHands(c.buySharesTotal),
            sellHands: fmtHands(c.sellSharesTotal),
            cls: c.realizedNet >= 0 ? 'up' : 'down',
            sells // 卖出明细（清仓记录）
          };
        })),
        closedCount: '' + closedList.length,
        closedRealized: fmtMoney(closedRealized),
        closedRealizedCls: closedRealized >= 0 ? 'up' : 'down',

        loading: false
      });
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  onTabChange(e) {
    this.setData({ activeTab: e.detail.index });
  },

  goBuy() {
    wx.navigateTo({ url: '/pages/buy/buy' });
  },

  // 补仓：带股票代码/名称跳转买入页，预填并显示「补仓」提示
  goBuyCode(e) {
    const { code, name } = e.currentTarget.dataset;
    wx.navigateTo({
      url: '/pages/buy/buy?add=1&code=' + encodeURIComponent(code || '') + '&name=' + encodeURIComponent(name || '')
    });
  },

  goSell(e) {
    const { code } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/sell/sell?code=' + encodeURIComponent(code || '') });
  },

  // 左滑露出右侧「删除」后点击删除（持仓与清仓通用）
  delStock(e) {
    const { code, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除记录',
      content: `将删除「${name || code}」的全部持仓与交易流水，且不可恢复。确定删除？`,
      confirmText: '删除',
      confirmColor: '#e64340',
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '删除中' });
        try {
          await removeStock(code);
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          this.load();
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: '删除失败', icon: 'none' });
        }
      }
    });
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  }
});
