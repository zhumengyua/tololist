// services/positions.js —— 持仓批次与买卖交易（本地存储版）
const { get, set } = require('../utils/storage');
const { calcBuy, calcSell, allocateFIFO } = require('../utils/calc');

const POS_KEY = 'stock_positions';
const REC_KEY = 'stock_records';

function uid(prefix) {
  return (prefix || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function todayStr() {
  const d = new Date();
  const p = n => (n < 10 ? '0' + n : '' + n);
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 买入：新增持仓批次 + 写入流水 */
async function doBuy(p) {
  const buy = calcBuy(p.buyNum, p.buyPrice, p.feeCfg);
  const list = get(POS_KEY, []);
  const batch = {
    id: uid('b'),
    code: p.code,
    name: p.name,
    buyNum: p.buyNum,
    buyPrice: p.buyPrice,
    buyFee: buy.fee,
    buyTime: p.buyTime || todayStr(),
    soldNum: 0,
    status: 'holding', // holding | closed
    createdAt: Date.now()
  };
  list.push(batch);
  set(POS_KEY, list);

  if (p.withRecord !== false) {
    pushRecord({
      type: 'buy',
      code: p.code,
      name: p.name,
      num: p.buyNum,
      price: p.buyPrice,
      fee: buy.fee,
      time: batch.buyTime,
      profit: null,
      profitRate: null
    });
  }
  return { _id: batch.id, buy };
}

/**
 * 卖出：按最早买入批次优先消耗（FIFO做T），每个消耗批次单独生成一笔卖出流水、单独记盈亏
 * （与勾选「单笔持仓」卖出共用同一分笔记录格式；清仓某批次后该批次收益独立可查）
 */
async function doSell(s) {
  const list = get(POS_KEY, []);
  const batches = list.filter(b => b.code === s.code && b.status === 'holding');

  const totalRemain = batches.reduce((sum, b) => sum + (b.buyNum - (b.soldNum || 0)), 0);
  if (totalRemain <= 0) throw new Error('该股票无可用持仓');
  if (s.num > totalRemain) throw new Error('卖出数量超过可卖持仓');

  // FIFO：从最早买入批次开始消耗
  const ordered = batches
    .slice()
    .sort((a, b) => (a.buyTime || a.createdAt || 0) - (b.buyTime || b.createdAt || 0));

  let remain = s.num;
  const records = [];
  for (const doc of ordered) {
    if (remain <= 0) break;
    const rem = doc.buyNum - (doc.soldNum || 0);
    if (rem <= 0) continue;
    const take = Math.min(rem, remain);
    remain -= take;

    const sell = calcSell(take, s.price, s.feeCfg);
    const batchTotalCost = doc.buyPrice * doc.buyNum + (doc.buyFee || 0);
    const cost = batchTotalCost * (take / doc.buyNum);
    const profit = sell.net - cost;
    const profitRate = cost > 0 ? profit / cost : 0;

    records.push({
      id: uid('r'),
      type: 'sell',
      code: s.code,
      name: s.name || doc.name,
      num: take,
      price: s.price,
      fee: sell.fee,
      time: s.time || todayStr(),
      profit,
      profitRate,
      batchId: doc.id,
      createdAt: Date.now()
    });

    doc.soldNum = (doc.soldNum || 0) + take;
    if (doc.soldNum >= doc.buyNum) doc.status = 'closed';
  }

  set(POS_KEY, list);
  const recList = get(REC_KEY, []);
  recList.push(...records);
  set(REC_KEY, recList);

  const profit = records.reduce((sum, r) => sum + r.profit, 0);
  const net = records.reduce((sum, r) => sum + (r.num * r.price - r.fee), 0);
  return { profit, net, soldNum: s.num, records };
}

/**
 * 做T：按【指定买入批次】卖出（只卖勾选的仓位，每笔单独记盈亏）
 * @param {object} s { code, name, price, time, feeCfg, items:[{batchId, num(卖出股数)}] }
 * @returns {Array} 每条勾选批次独立生成的卖出流水(各含profit)
 */
async function doSellSelected(s) {
  if (!s.items || !s.items.length) throw new Error('请至少勾选一个买入批次');
  const list = get(POS_KEY, []);
  const records = [];
  const errors = [];

  for (const it of s.items) {
    const doc = list.find(b => b.id === it.batchId && b.status === 'holding');
    if (!doc) { errors.push('批次不存在或已清仓'); continue; }
    const remain = doc.buyNum - (doc.soldNum || 0);
    const num = it.num;
    if (!num || num <= 0) { errors.push(doc.buyTime + ' 该笔未填卖出数量'); continue; }
    if (num > remain) throw new Error(`批次(${doc.buyTime})卖出数量超过其剩余持仓`);

    const sell = calcSell(num, s.price, s.feeCfg);
    // 该笔对应买入成本（按数量比例分摊该批次含买入费的总成本）
    const batchTotalCost = doc.buyPrice * doc.buyNum + (doc.buyFee || 0);
    const cost = batchTotalCost * (num / doc.buyNum);
    const profit = sell.net - cost;
    const profitRate = cost > 0 ? profit / cost : 0;

    records.push({
      id: uid('r'),
      type: 'sell',
      code: s.code,
      name: s.name || doc.name,
      num,
      price: s.price,
      fee: sell.fee,
      time: s.time || todayStr(),
      profit,
      profitRate,
      batchId: doc.id, // 标记来源于哪笔买入（做T分开记录）
      createdAt: Date.now()
    });

    doc.soldNum = (doc.soldNum || 0) + num;
    if (doc.soldNum >= doc.buyNum) doc.status = 'closed';
  }

  set(POS_KEY, list);
  if (records.length) {
    const recList = get(REC_KEY, []);
    recList.push(...records);
    set(REC_KEY, recList);
  }
  if (errors.length && !records.length) throw new Error(errors[0]);
  return records;
}

/** 汇总持仓（按股票代码聚合，只统计 holding 批次） */
async function listHoldings() {
  const batches = get(POS_KEY, []).filter(b => b.status === 'holding');
  const map = {};
  batches.forEach(b => {
    const remain = b.buyNum - (b.soldNum || 0);
    if (remain <= 0) return;
    if (!map[b.code]) {
      map[b.code] = { code: b.code, name: b.name, held: 0, totalCost: 0, batchCount: 0 };
    }
    const g = map[b.code];
    const remainCost = ((b.buyPrice * b.buyNum + (b.buyFee || 0)) * remain) / b.buyNum;
    g.held += remain;
    g.totalCost += remainCost;
    g.batchCount += 1;
  });

  const list = Object.values(map).map(g => ({
    code: g.code,
    name: g.name,
    held: g.held,
    avgCost: g.held > 0 ? g.totalCost / g.held : 0,
    totalCost: g.totalCost,
    batchCount: g.batchCount
  }));
  return list.sort((a, b) => b.totalCost - a.totalCost);
}

/** 取单只股票持仓批次明细（按买入时间升序） */
async function listBatches(code) {
  const batches = get(POS_KEY, [])
    .filter(b => b.code === code && b.status === 'holding')
    .sort((a, b) => (a.buyTime || a.createdAt || 0) - (b.buyTime || b.createdAt || 0));
  return batches.map(b => ({
    id: b.id,
    code: b.code,
    name: b.name,
    buyPrice: b.buyPrice,
    buyNum: b.buyNum,
    buyFee: b.buyFee,
    buyTime: b.buyTime,
    soldNum: b.soldNum,
    remain: b.buyNum - (b.soldNum || 0)
  }));
}

/** 交易流水（近 N 条） */
async function listRecords(limit = 50) {
  const data = get(REC_KEY, [])
    .slice()
    .sort((a, b) => (a.time || '').localeCompare(b.time || '') || (a.createdAt || 0) - (b.createdAt || 0))
    .reverse()
    .slice(0, limit);
  return data;
}

/**
 * 取某只股票的卖出记录明细（按时间升序），用于清仓记录展示
 */
async function listSells(code) {
  return get(REC_KEY, [])
    .filter(r => r.type === 'sell' && r.code === code)
    .sort((a, b) => (a.time || '').localeCompare(b.time || '') || (a.createdAt || 0) - (b.createdAt || 0));
}

/**
 * 删除单只股票：移除该股票的全部持仓批次 + 全部交易流水（不可恢复）
 */
async function removeStock(code) {
  set(POS_KEY, get(POS_KEY, []).filter(b => b.code !== code));
  set(REC_KEY, get(REC_KEY, []).filter(r => r.code !== code));
}

function pushRecord(r) {
  const list = get(REC_KEY, []);
  list.push(Object.assign({ id: uid('r'), createdAt: Date.now() }, r));
  set(REC_KEY, list);
}

/**
 * 个股汇总统计（基于全部流水按 code 移动加权重算，含加仓/历史卖出/已实现）
 * 返回每票：持仓、摊薄成本、累计买入本金与股数/次数、累计卖出量与净额、
 *         累计已实现净盈亏、净投入、市值(无行情以成本兜底)、累计总盈亏、盈亏率
 */
function listStockStats() {
  const records = get(REC_KEY, [])
    .slice()
    .sort((a, b) => (a.time || '').localeCompare(b.time || '') || (a.createdAt || 0) - (b.createdAt || 0));

  const map = {};
  records.forEach(r => {
    if (!map[r.code]) {
      map[r.code] = {
        code: r.code,
        name: r.name,
        H: 0, TC: 0, avg: 0,
        buyCount: 0, buySharesTotal: 0, buyAmountTotal: 0, buyFeeTotal: 0,
        sellSharesTotal: 0, sellNetTotal: 0,
        realizedNet: 0, realizedCost: 0
      };
    }
    const g = map[r.code];
    const amount = r.num * r.price;
    if (r.type === 'buy') {
      g.buyCount += 1;
      g.buySharesTotal += r.num;
      g.buyAmountTotal += amount;
      g.buyFeeTotal += r.fee || 0;
      g.TC += amount + (r.fee || 0);
      g.H += r.num;
      g.avg = g.TC / g.H;
    } else {
      g.realizedNet += typeof r.profit === 'number' ? r.profit : 0;
      g.realizedCost += r.num * g.avg;
      g.sellSharesTotal += r.num;
      g.sellNetTotal += amount - (r.fee || 0);
      g.H -= r.num;
      if (g.H <= 0) { g.H = 0; g.TC = 0; g.avg = 0; }
    }
  });

  return Object.values(map).map(g => {
    const totalCost = g.avg * g.H;          // 持仓总成本
    const marketValue = totalCost;          // 无行情，成本兜底（待接现价）
    const floating = marketValue - totalCost; // = 0（无行情）
    const totalProfit = floatzero(floating) + g.realizedNet;
    const buyCostTotal = g.buyAmountTotal + g.buyFeeTotal; // 累计买入投入(含费用)
    const netInvest = buyCostTotal - g.sellNetTotal;       // 净投入
    return {
      code: g.code,
      name: g.name,
      held: g.H,
      avgCost: g.H > 0 ? g.avg : 0,
      totalCost,
      heldShares: g.H,
      buyCount: g.buyCount,
      buySharesTotal: g.buySharesTotal,
      buyAmountTotal: g.buyAmountTotal,
      buyCostTotal,
      sellSharesTotal: g.sellSharesTotal,
      sellNetTotal: g.sellNetTotal,
      realizedNet: g.realizedNet,
      realizedCost: g.realizedCost,
      realizedRate: g.realizedCost > 0 ? g.realizedNet / g.realizedCost : 0,
      netInvest,
      marketValue,
      floating,
      floatingRate: totalCost > 0 ? floating / totalCost : 0,
      totalProfit,
      totalRate: netInvest > 0 ? totalProfit / netInvest : 0
    };
  }).sort((a, b) => b.totalProfit - a.totalProfit);
}

function floatzero(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

module.exports = {
  doBuy,
  doSell,
  doSellSelected,
  listHoldings,
  listBatches,
  listRecords,
  listSells,
  listStockStats,
  removeStock
};
