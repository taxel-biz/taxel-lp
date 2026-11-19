// トップと /lp/a・c・s。影の色が他のページと少し違う（旧設定のまま）
module.exports = {
  theme: { extend: {
    fontFamily: { sans: ['Inter', '"Noto Sans JP"', 'sans-serif'] },
    colors: {
      ink: '#0E1A33', paper: '#FCFCFB',
      brand: { 50: '#EEF5FE', 100: '#DCEBFD', 300: '#8CC6FA', 400: '#4AACF7', 500: '#2B78E6', 600: '#1645C4', 700: '#12379D' },
    },
    boxShadow: {
      soft: '0 1px 2px rgba(14,26,51,0.04), 0 1px 1px rgba(14,26,51,0.03)',
      card: '0 1px 3px rgba(14,26,51,0.05), 0 12px 32px -12px rgba(14,26,51,0.12)',
      cardHover: '0 1px 3px rgba(14,26,51,0.06), 0 20px 44px -14px rgba(14,26,51,0.18)',
      panel: '0 24px 70px -20px rgba(14,26,51,0.22)',
    },
  } },
};
