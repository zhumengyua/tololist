// utils/format.js —— 金额/数量/费率格式化
function fmtMoney(v) {
  const n = Number(v);
  if (isNaN(n)) return '0.00';
  return n.toFixed(2);
}

function fmtNum(v) {
  const n = Number(v);
  if (isNaN(n)) return '0';
  return n.toFixed(n % 1 === 0 ? 0 : 2);
}

function fmtRate(v, digits) {
  const n = Number(v);
  if (isNaN(n)) return '0.00%';
  const d = digits == null ? 2 : digits;
  return (n * 100).toFixed(d) + '%';
}

// 股数转手数显示：1手=100股，整手不带小数，非整手保留1位
function fmtHands(shares) {
  const n = Number(shares) / 100;
  if (isNaN(n)) return '0';
  const fixed = (Math.round(n * 10) / 10).toString();
  return fixed.replace(/\.0$/, '');
}

// 金额缩写：>=1亿→x.xx亿，>=1万→x.xx万，否则整数元
function fmtAmount(v) {
  const n = Number(v);
  if (isNaN(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e8) return (n / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (n / 1e4).toFixed(2) + '万';
  return n.toFixed(0);
}

module.exports = { fmtMoney, fmtNum, fmtRate, fmtHands, fmtAmount };
