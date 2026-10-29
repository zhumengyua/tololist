// utils/calc.js —— 买入/卖出费用与收益计算
const { DEFAULT_FEES, calcFees } = require('./fee');

/**
 * 计算一次买入的费用与总成本
 * @param {number} num 数量
 * @param {number} price 成交价
 * @param {object} feeCfg 费用参数（与 DEFAULT_FEES 合并）
 * @returns {object} { amount, fee, totalCost }
 */
function calcBuy(num, price, feeCfg) {
  const amount = num * price;
  const fee = calcFees(amount, feeCfg, false);
  return { amount, fee, totalCost: amount + fee };
}

/**
 * 计算一次卖出的净额
 * @param {number} num 卖出数量
 * @param {number} price 卖出价
 * @param {object} feeCfg
 * @returns {object} { amount, fee, net }
 */
function calcSell(num, price, feeCfg) {
  const amount = num * price;
  const fee = calcFees(amount, feeCfg, true);
  return { amount, fee, net: amount - fee };
}

/**
 * FIFO 分摊卖出：按买入时间最早优先扣减剩余持仓，分配各批次买入成本（含各自买入费用）
 * @param {Array} batches 该股票的持仓批次（含 buyNum/buyPrice/buyFee/soldNum/buyTime）
 * @param {number} sellNum 本次卖出数量
 * @returns {object} { allocatedCost, remainBatches, realizedProfit }
 *    allocatedCost: 卖出数量对应分摊的买入总成本
 */
function allocateFIFO(batches, sellNum) {
  let remain = sellNum;
  let allocatedCost = 0;
  // 深拷贝批次，避免污染原对象（仅改内部字段）
  const remainBatches = batches
    .slice()
    .sort((a, b) => (a.buyTime || a.createdAt || 0) - (b.buyTime || b.createdAt || 0))
    .map(b => Object.assign({}, b));

  for (let i = 0; i < remainBatches.length && remain > 0; i++) {
    const b = remainBatches[i];
    const rem = b.buyNum - (b.soldNum || 0); // 该批次剩余可卖
    if (rem <= 0) continue;
    const take = Math.min(rem, remain);
    remain -= take;
    // 该批次总成本按其剩余数量比例分摊
    const batchTotalCost = b.buyPrice * b.buyNum + (b.buyFee || 0);
    allocatedCost += batchTotalCost * (take / b.buyNum);
    b.soldNum = (b.soldNum || 0) + take;
    if (b.soldNum >= b.buyNum) b.closed = true;
  }

  return { allocatedCost, remainBatches };
}

/**
 * 计算卖出预估收益（供界面预览，不做扣减）
 * @param {number} sellNum
 * @param {number} sellPrice
 * @param {Array} batches 持仓批次
 * @param {object} feeCfg
 * @returns {object|{error}}
 */
function calcSellProfit(sellNum, sellPrice, batches, feeCfg) {
  const sell = calcSell(sellNum, sellPrice, feeCfg);
  const { allocatedCost } = allocateFIFO(batches, sellNum);
  const profit = sell.net - allocatedCost;
  const profitRate = allocatedCost > 0 ? profit / allocatedCost : 0;
  return {
    sellNet: sell.net,
    sellFee: sell.fee,
    allocatedCost,
    profit,
    profitRate,
    sellAmount: sell.amount
  };
}

module.exports = {
  DEFAULT_FEES,
  calcBuy,
  calcSell,
  calcSellProfit,
  allocateFIFO
};
