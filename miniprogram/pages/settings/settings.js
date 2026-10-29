// 费用设置页
const { getSettings, saveSettings } = require('../../services/settings');
const { sanitizeNum } = require('../../utils/input');

Page({
  data: {
    commissionStr: '',
    minCommissionStr: '',
    stampStr: '',
    transferStr: ''
  },

  // 界面以百分比展示，内部存小数
  async onLoad() {
    try {
      const s = await getSettings();
      this.setData({
        commissionStr: (s.commissionRate * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') || '0',
        minCommissionStr: String(s.minCommission),
        stampStr: (s.stampTax * 100).toString(),
        transferStr: (s.transferFee * 100).toString()
      });
    } catch (e) {
      wx.showToast({ title: '读取设置失败', icon: 'none' });
    }
  },

  onInput(e) {
    const key = e.currentTarget.dataset.key;
    // 全部为数值输入：过滤非数字字符，费率允许最多5位小数
    this.setData({ [key + 'Str']: sanitizeNum(e.detail.value, 5) });
  },

  async onSave() {
    const { commissionStr, minCommissionStr, stampStr, transferStr } = this.data;
    const commissionRate = parseFloat(commissionStr) / 100;
    const minCommission = parseFloat(minCommissionStr);
    const stampTax = parseFloat(stampStr) / 100;
    const transferFee = parseFloat(transferStr) / 100;

    if (isNaN(commissionRate) || isNaN(minCommission) || isNaN(stampTax) || isNaN(transferFee)) {
      return wx.showToast({ title: '请填写合法的数值', icon: 'none' });
    }

    wx.showLoading({ title: '保存中' });
    try {
      await saveSettings({ commissionRate, minCommission, stampTax, transferFee });
      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    }
  }
});
