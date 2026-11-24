// サイト共通（記事・会社概要・診断・資料DLなど）。旧 Play CDN の tailwind.config をそのまま移したもの
module.exports = {
  theme: { extend: {
    fontFamily: { sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"Hiragino Sans"', '"Hiragino Kaku Gothic ProN"', '"Yu Gothic"', 'YuGothic', 'Meiryo', 'sans-serif'] },  // 2026-11-24 Webフォントをやめ端末のフォントに（表示速度）
    colors: {
      ink: '#0E1A33', paper: '#FCFCFB',
      brand: { 50: '#EEF5FE', 100: '#DCEBFD', 300: '#8CC6FA', 400: '#4AACF7', 500: '#2B78E6', 600: '#1645C4', 700: '#12379D' },
      indigo: { 50: '#EEF5FE', 100: '#DCEBFD', 300: '#8CC6FA', 400: '#4AACF7', 500: '#2B78E6', 600: '#1645C4', 700: '#12379D' },
    },
    boxShadow: {
      soft: '0 1px 2px rgba(15,23,42,0.04), 0 1px 1px rgba(15,23,42,0.03)',
      card: '0 1px 3px rgba(15,23,42,0.05), 0 12px 32px -12px rgba(15,23,42,0.12)',
      cardHover: '0 1px 3px rgba(15,23,42,0.06), 0 20px 44px -14px rgba(15,23,42,0.18)',
      panel: '0 24px 70px -20px rgba(15,23,42,0.22)',
    },
  } },
};
