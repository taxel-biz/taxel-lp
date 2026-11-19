// 初期の3ページ（column/kitai-gap・keiei/cloud-kaikei-hikaku・keiei/kessansho-yomikata）。ink の色と indigo（Tailwind標準）が違う
module.exports = {
  theme: { extend: {
    fontFamily: { sans: ['Inter', '"Noto Sans JP"', 'sans-serif'] },
    colors: { ink: '#0B1220', paper: '#FCFCFB' },
    boxShadow: {
      soft: '0 1px 2px rgba(15,23,42,0.04), 0 1px 1px rgba(15,23,42,0.03)',
      card: '0 1px 3px rgba(15,23,42,0.05), 0 12px 32px -12px rgba(15,23,42,0.12)',
    },
  } },
};
