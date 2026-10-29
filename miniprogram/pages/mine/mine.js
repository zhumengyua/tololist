// 我的
const { listRecords, listStockStats } = require('../../services/positions');
const { exportBackup, importBackup } = require('../../services/backup');
const { fmtMoney, fmtHands, fmtRate } = require('../../utils/format');

Page({
  data: {
    recordCount: 0,
    records: [],
    loaded: false,
    showImport: false,
    importStr: '',
    summary: null, // 总账概览：累计盈亏/盈亏率/资金明细
    heatWeeks: [], // 近一年操作热力图（周列×7行）
    heatActiveDays: 0,
    heatTotalOps: 0
  },

  onShow() {
    this.loadRecords();
  },

  // 汇总所有股票：累计盈亏（已实现+估浮动）、盈亏率、投入产出
  buildSummary() {
    const stats = listStockStats();
    if (!stats.length) return null;
    let realized = 0, realizedCost = 0, buyCost = 0, sellNet = 0, holdingCost = 0;
    stats.forEach(s => {
      realized += s.realizedNet;
      realizedCost += s.realizedCost;
      buyCost += s.buyCostTotal;
      sellNet += s.sellNetTotal;
      holdingCost += s.totalCost;
    });

    // 无行情：浮动盈亏用「该票最近一次成交价」估算
    const allRecs = this._allRecs || []; // 已按时间倒序，首次出现即最新成交价
    const lastPrice = {};
    allRecs.forEach(r => { if (lastPrice[r.code] === undefined) lastPrice[r.code] = r.price; });
    let floating = 0;
    stats.forEach(s => {
      const p = lastPrice[s.code];
      if (s.held > 0 && p) floating += (p - s.avgCost) * s.held;
    });

    const total = realized + floating;
    const netInvest = buyCost - sellNet; // 净投入（沉淀资金）
    return {
      hasSell: sellNet > 0,
      hasHolding: holdingCost > 0,
      total: (total >= 0 ? '+' : '') + fmtMoney(total),
      totalCls: total >= 0 ? 'up' : 'down',
      // 盈亏率：总盈亏 ÷ 净投入
      rate: fmtRate(netInvest > 0 ? total / netInvest : 0),
      rateCls: total >= 0 ? 'up' : 'down',
      realizedText: (realized >= 0 ? '+' : '') + fmtMoney(realized),
      realizedCls: realized >= 0 ? 'up' : 'down',
      floatingText: (floating >= 0 ? '+' : '') + fmtMoney(floating),
      floatingCls: floating >= 0 ? 'up' : 'down',
      buyCostText: fmtMoney(buyCost),
      sellNetText: fmtMoney(sellNet),
      netInvestText: fmtMoney(netInvest),
      holdingCostText: fmtMoney(holdingCost),
      stockCount: stats.length
    };
  },

  // GitHub 风格操作热力图：近一年，按天聚合交易笔数，分 5 档深浅
  buildHeat(allRecs) {
    const countByDay = {};
    allRecs.forEach(r => {
      if (r.time) countByDay[r.time] = (countByDay[r.time] || 0) + 1;
    });

    const WEEKS = 53;
    const today = new Date();
    // 对齐到本周六结束：从今天的周六往前推 WEEKS-1 周的周日开始
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const start = new Date(end);
    start.setDate(start.getDate() - (WEEKS * 7 - 1));
    // 回退到所在周的周日，保证每列满 7 行
    start.setDate(start.getDate() - start.getDay());

    const pad = n => (n < 10 ? '0' + n : '' + n);
    const key = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

    const weeks = [];
    let activeDays = 0, totalOps = 0;
    const cursor = new Date(start);
    while (cursor <= end) {
      const week = [];
      for (let i = 0; i < 7; i++) {
        const k = key(cursor);
        const c = countByDay[k] || 0;
        if (c > 0) { activeDays++; totalOps += c; }
        // 未来日期（本周还没到的天）标 grey 不渲染颜色
        const future = cursor > end;
        week.push({
          k,
          lv: c === 0 ? 0 : c >= 8 ? 4 : c >= 5 ? 3 : c >= 2 ? 2 : 1,
          future,
          c
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      weeks.push({ days: week });
    }
    return { weeks, activeDays, totalOps };
  },

  async loadRecords() {
    try {
      const records = await listRecords(30);
      // 全量流水（近9999条，倒序）供总账浮盈估算；取每票首次出现即最新成交价
      const allRecs = await listRecords(9999);
      this._allRecs = allRecs;
      const heat = this.buildHeat(allRecs);
      this.setData({
        summary: this.buildSummary(),
        heatWeeks: heat.weeks,
        heatActiveDays: heat.activeDays,
        heatTotalOps: heat.totalOps,
        records: records.map(r => ({
          id: r.id,
          type: r.type,
          name: r.name,
          code: r.code,
          num: fmtHands(r.num),
          price: r.price,
          time: r.time || '',
          fee: fmtMoney(r.fee),
          profit: fmtMoney(r.profit),
          profitRate: fmtMoney(r.profitRate * 100) + '%'
        })),
        recordCount: records.filter(r => r.type).length,
        loaded: true
      });
    } catch (e) {
      this.setData({ loaded: true });
    }
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  // 点击热力图某格：显示该日操作笔数
  onHeatTap(e) {
    const { date, c } = e.currentTarget.dataset;
    wx.showToast({ title: date + (c > 0 ? ' 操作 ' + c + ' 笔' : ' 无操作'), icon: 'none' });
  },

  // 导出：生成备份 JSON 复制到剪贴板
  goExport() {
    try {
      const str = exportBackup();
      wx.setClipboardData({
        data: str,
        success() {
          wx.showToast({ title: '已复制备份内容', icon: 'success' });
        }
      });
    } catch (e) {
      wx.showToast({ title: '导出失败', icon: 'none' });
    }
  },

  goImport() {
    this.setData({ showImport: true });
  },

  onImportInput(e) {
    this.setData({ importStr: e.detail.value });
  },

  doImport() {
    const str = (this.data.importStr || '').trim();
    if (!str) return wx.showToast({ title: '请先粘贴备份内容', icon: 'none' });

    wx.showModal({
      title: '确认导入',
      content: '导入会用备份内容覆盖当前本机数据，确定继续？',
      success: (res) => {
        if (!res.confirm) return;
        try {
          const r = importBackup(str);
          this.setData({ showImport: false, importStr: '' });
          wx.showToast({ title: `已导入 ${r.positions}持仓/${r.records}流水`, icon: 'none' });
          this.loadRecords();
        } catch (e) {
          wx.showToast({ title: e.message || '导入失败', icon: 'none' });
        }
      }
    });
  }
});
