/* taXel 共通ナビ：幅が狭いときも、ヘッダー下にボタン行を出す（横スクロール）。アンカー位置の補正つき */
(function () {
  var st = document.createElement('style');
  st.textContent = '[id]{scroll-margin-top:112px}@media(min-width:1024px){[id]{scroll-margin-top:72px}}' +
    '.tx-strip{scrollbar-width:none}.tx-strip::-webkit-scrollbar{display:none}';
  document.head.appendChild(st);

  var header = document.querySelector('header');
  var nav = header && header.querySelector('nav');
  if (!header || !nav) return;

  var strip = document.createElement('div');
  strip.className = 'tx-strip lg:hidden flex gap-5 overflow-x-auto px-6 py-2.5 border-t border-slate-100 bg-white/70';
  nav.querySelectorAll('a').forEach(function (a) {
    var active = a.className.split(' ').indexOf('border-brand-600') > -1;
    var l = document.createElement('a');
    l.href = a.getAttribute('href');
    l.textContent = a.textContent.trim();
    l.className = 'shrink-0 text-[14px] px-1 py-1 font-bold whitespace-nowrap border-b-2 ' +
      (active ? 'text-brand-600 border-brand-600' : 'text-ink border-transparent hover:text-brand-600');
    strip.appendChild(l);
  });
  header.appendChild(strip);
})();
