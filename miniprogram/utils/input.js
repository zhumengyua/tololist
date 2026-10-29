// utils/input.js —— 输入框数值过滤
// 小程序 type=number/digit 只约束软键盘，粘贴或第三方输入法仍可混入非法字符，
// 在 bindinput 里统一过滤。

// 正整数：剔除所有非数字，去前导0
function sanitizeInt(v) {
  return String(v).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

// 正小数：只留数字和一个小数点，小数位限 digits（默认2）
function sanitizeNum(v, digits) {
  const d = digits == null ? 2 : digits;
  let s = String(v).replace(/[^\d.]/g, '');
  const i = s.indexOf('.');
  if (i >= 0) {
    // 只保留第一个小数点
    s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');
    // 限小数位
    s = s.slice(0, i + 1 + d);
  }
  return s;
}

module.exports = { sanitizeInt, sanitizeNum };
