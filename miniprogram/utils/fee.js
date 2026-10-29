// utils/fee.js —— 默认费用参数与费用计算
// 费用标准以用户实际券商为准，以下为可配置的默认假设值

const DEFAULT_FEES = {
  commissionRate: 0.00025, // 佣金率 万2.5
  minCommission: 5,        // 最低佣金（元）
  stampTax: 0.001,         // 印花税 0.1%（按用户锁定口径，仅卖出）
  transferFee: 0.00001     // 过户费 万0.1（成交金额0.001%），买卖双收
};

// 计算单笔费用（金额=数量×价格）
function calcFees(amount, feeCfg, isSell) {
  const cfg = Object.assign({}, DEFAULT_FEES, feeCfg || {});
  const commission = Math.max(amount * cfg.commissionRate, cfg.minCommission);
  let fee = commission;
  // 过户费 买卖双收
  fee += amount * cfg.transferFee;
  // 印花税 仅卖出
  if (isSell) {
    fee += amount * cfg.stampTax;
  }
  return fee;
}

module.exports = {
  DEFAULT_FEES,
  calcFees
};
