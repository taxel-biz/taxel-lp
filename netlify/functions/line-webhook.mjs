// taXel公式LINE（@998kywlv）の Webhook：URLが届いたら、そのサイトのトップページを読んで簡易診断を返す。
// - AIは使わない。決まったルールで判定する（仕様：deliverables/taxel_competitor_crm_20261102/57_line_quick_diag_spec.md）
// - 返信は返信トークンで行う（無料・月200通に数えない）
// - キーワード（費用と契約 など）は管理画面の応答メッセージが返すので、ここでは何もしない。
//   あいさつ（友だち追加）・「無料診断」・「最初に戻る」・「デモの質問」はここで返す（本物のボタン・縦一覧のカードは管理画面では作れないため）
// - 簡易診断のあと、質問1は約8秒あけてプッシュで送る（その間「入力中」を表示）。プッシュは月の無料枠を1通使う
// - 簡易診断：診断カード → 質問2つ（ボタン。答えは postback のデータで引き継ぎ、サーバーに保存しない）→ 結果カード
//   仕様：deliverables/taxel_competitor_crm_20261102/59_line_quick_diag_v2.md（追記4・5が最新）
// - 鍵は Netlify の環境変数（LINE_CHANNEL_SECRET / LINE_CHANNEL_ACCESS_TOKEN）。コードやログに値を出さない
// - 利用者が送ったURLを読みに行くので、公開サイト以外（社内・クラウドの管理用アドレス等）へは接続しない。
//   接続に使うIPアドレスは「確かめたそのアドレス」に固定する（http(s).request の lookup を差し替え）
import crypto from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const config = { path: "/api/line-webhook" };

const KEYWORDS = new Set(["費用と契約", "先生の手間", "15分の説明", "ほかの質問", "無料診断をはじめる"]);
export const MSG = {
  fallback: "メッセージありがとうございます。\n担当者が確認して、1営業日以内にお返事します。",
  unread: "URLを受け取りました。自動では読み取れなかったため、担当者が確認して、1営業日以内にお返事します。",
  ask: "ご覧いただいたデモ・レポートや、サービスについて、知りたいことをお選びください。",
  greet: "友だち追加ありがとうございます。\ntaXel（タクセル）です。",
  start: "ホームページのURLを、\nこのトークにお送りください。\n例）https://www.〇〇-tax.jp\n\nその場で簡易診断をお返しし、\n1営業日以内に、近くの事務所と比べた\n詳しいレポート（PDF）を\nお届けします。\n\nURLが分からない場合は、\n事務所名と地域（例：〇〇市）でも\n大丈夫です。\n\n個人情報の取り扱い：\nhttps://www.taxel.biz/privacy/",
  busy: "URLを受け取りました。担当者が確認して、1営業日以内にお返事します。",
};
const SITE_MS = 6000;             // サイトの読み込みにかける時間の上限
const REPLY_MS = 3000;            // 返信APIにかける時間の上限
const MAX_BYTES = 1500000;        // 読むHTMLの上限（超えたら「読み取れなかった」扱い）
const MAX_HOPS = 4;               // リダイレクトの上限
const PARALLEL = 3;               // 同時に読みに行くサイトの数
const TOTAL_MS = 40000;           // 1回の通知の処理全体の上限（Netlify の上限60秒・返信トークンの1分より内側）
const MIN_SITE_MS = 1500;         // これより短い時間しか残っていなければ、読みに行かず「担当者が確認」と返す
// スマホのブラウザとして読む（見込み客はスマホで見る。スマホ用に別のページを返すサイトがある）
const DELAY_MS = 8000;            // 診断カードから質問1までの間（診断を読んでもらうため）
const CARD_IMG = "https://www.taxel.biz/assets/line/card_fv.png";
const BOOK = "https://calendar.google.com/calendar/appointments/schedules/AcZssZ0THxEfmFAbMM24_U7hvCWGjHQNR2w2Bo2b9hinyHPR2wZ9s9SzGMj_qMYtuGjqmVpljHgDjzw1";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// ---------- 署名（生のバイト列で計算し、正規のbase64表記だけを受け付ける） ----------
export function verify(raw, signature, secret) {
  if (!signature || !secret) return false;
  const sig = String(signature);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(sig)) return false;
  const mac = crypto.createHmac("sha256", secret).update(Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), "utf8")).digest();
  const got = Buffer.from(sig, "base64");
  if (got.toString("base64") !== sig) return false;
  return got.length === mac.length && crypto.timingSafeEqual(got, mac);
}

// ---------- URLの取り出し（トップページを見る。メールアドレスのドメインは拾わない） ----------
const TLD = "(?:co\\.jp|or\\.jp|ne\\.jp|ac\\.jp|go\\.jp|jp|com|net|org|biz|info|tokyo|osaka|nagoya|yokohama|xyz|site|online|tax|work|link|me|co|io)";
const BARE = new RegExp("(?:^|[^a-z0-9.@-])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+" + TLD + ")(?=$|[^a-z0-9.@-])", "i");
export function findUrl(textIn) {
  const t = String(textIn || "").normalize("NFKC");
  let u = null;
  const m = t.match(/https?:\/\/[^\s<>"'「」（）()、。]+/i);
  if (m) u = m[0].replace(/[.,]+$/, "");
  else {
    const b = t.match(BARE);
    if (b) u = "https://" + b[1];
  }
  if (!u) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== "http:" && x.protocol !== "https:") return null;
    return x.protocol + "//" + x.host + "/";
  } catch { return null; }
}

// ---------- 接続してよい相手か（IPv4の公開アドレスだけ。IPアドレス直書きのURLは受け付けない） ----------
export function isPrivateV4(ip) {
  if (!net.isIPv4(ip)) return true;
  const [a, b] = ip.split(".").map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && ip.split(".")[2] === "100") || (a === 203 && b === 0 && ip.split(".")[2] === "113") || (a === 192 && b === 88 && ip.split(".")[2] === "99");
}
export function hostOk(u) {
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== "80" && u.port !== "443") return false;
  const host = u.hostname;
  if (!host || net.isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".")) return false;
  if (/(^|\.)(localhost|local|internal|lan|home|corp|intranet)$/i.test(host)) return false;
  return true;
}
// 接続の直前に名前解決し、公開IPv4だけを渡す（ここで確かめたアドレスにそのまま接続する）
export function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { family: 4, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const list = addrs || [];
    if (!list.length || list.some((a) => isPrivateV4(a.address))) return cb(Object.assign(new Error("blocked address"), { code: "EBLOCKED" }));
    if (options && options.all) return cb(null, list.map((a) => ({ address: a.address, family: 4 })));
    cb(null, list[0].address, 4);
  });
}

function charsetOf(ct, head) {
  let v = (String(ct || "").match(/charset\s*=\s*["']?([\w.:-]+)/i) || [])[1];
  if (!v) {
    for (const x of tokenize(head, 400).toks) {
      if (x.t !== "open" || x.name !== "meta") continue;
      if (x.a.charset) { v = x.a.charset; break; }
      if (lowerAscii(x.a["http-equiv"] || "") === "content-type") { const m = String(x.a.content || "").match(/charset\s*=\s*["']?([\w.:-]+)/i); if (m) { v = m[1]; break; } }
    }
  }
  let cs = lowerAscii(String(v || "utf-8").trim());
  if (/^(x-)?(sjis|shift-jis|ms_kanji|windows-31j|cp932)$/.test(cs)) cs = "shift_jis";
  return cs;
}
export function decode(buf, ct) {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder("utf-8").decode(buf.subarray(3));
  const cs = charsetOf(ct, buf.subarray(0, 8192).toString("latin1"));
  try { return new TextDecoder(cs).decode(buf); } catch { return null; }   // 知らない文字コードは「読み取れなかった」扱い
}

// 1回分の取得（リダイレクトは呼び出し側で追う）。期限・上限を超えたら null
function getOnce(u, deadline) {
  return new Promise((resolve) => {
    const left = deadline - Date.now();
    if (left <= 0) return resolve(null);
    const lib = u.protocol === "https:" ? https : http;
    let done = false, timer = null;
    const finish = (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const req = lib.request(u, { method: "GET", lookup: safeLookup, headers: { "User-Agent": UA, "Accept": "text/html", "Accept-Encoding": "identity" } }, (res) => {
      const st = res.statusCode || 0;
      if (st >= 300 && st < 400 && res.headers.location) { res.destroy(); return finish({ redirect: res.headers.location }); }
      const ct = res.headers["content-type"] || "";
      const ce = lowerAscii(String(res.headers["content-encoding"] || "identity")).trim();
      if (st < 200 || st >= 300 || (ct && !/html/i.test(ct)) || (ce && ce !== "identity")) { res.destroy(); return finish(null); }
      const chunks = []; let n = 0;
      res.on("data", (c) => { n += c.length; if (n > MAX_BYTES) { res.destroy(); finish(null); } else chunks.push(c); });
      res.on("end", () => finish({ buf: Buffer.concat(chunks), ct }));
      res.on("error", () => finish(null));
      res.on("aborted", () => finish(null));
    });
    timer = setTimeout(() => { req.destroy(); finish(null); }, left);
    req.on("error", () => finish(null));
    req.end();
  });
}

export async function fetchPage(url, deadline = Date.now() + SITE_MS) {
  let u;
  try { u = new URL(url); } catch { return null; }
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!hostOk(u)) return null;
    const r = await getOnce(u, deadline);
    if (!r) return null;
    if (r.redirect) { try { u = new URL(r.redirect, u); } catch { return null; } continue; }
    const html = decode(r.buf, r.ct);
    return html ? { html, url: u.href } : null;
  }
  return null;
}

// ---------- HTMLの字句解析（正規表現の総当たりを使わず、前から1回なめるだけ） ----------
// 大文字小文字はASCIIだけそろえる（toLowerCase は文字数が変わる字があり、位置がずれる）
const lowerAscii = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function unescape(s) {
  return String(s).replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e) => {
    if (e[0] === "#") { const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(c); } catch { return " "; } }
    return ENT[lowerAscii(e)] ?? m;
  });
}
const RAW = new Set(["script", "style", "noscript", "textarea", "title", "iframe", "xmp", "noembed", "noframes"]);
const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\f";
// 開始タグの中身（名前の後ろ）から属性を読む。引用符の中の「name=」は属性として扱わない
function parseAttrs(src) {
  const out = {}; let i = 0; const n = src.length;
  while (i < n) {
    while (i < n && (isSpace(src[i]) || src[i] === "/")) i++;
    let k = i;
    while (k < n && !isSpace(src[k]) && src[k] !== "=" && src[k] !== "/" ) k++;
    const name = lowerAscii(src.slice(i, k)); i = k;
    while (i < n && isSpace(src[i])) i++;
    let val = "";
    if (src[i] === "=") {
      i++;
      while (i < n && isSpace(src[i])) i++;
      const q = src[i];
      if (q === '"' || q === "'") { const e = src.indexOf(q, i + 1); val = e < 0 ? src.slice(i + 1) : src.slice(i + 1, e); i = e < 0 ? n : e + 1; }
      else { let e = i; while (e < n && !isSpace(src[e])) e++; val = src.slice(i, e); i = e; }
    }
    if (name && !(name in out)) out[name] = unescape(val).trim();
    if (k === i && !name) i++;
  }
  return out;
}
// 引用符を考えて、開始タグの終わり（>）を探す
function tagEnd(h, from) {
  let q = null;
  for (let i = from; i < h.length; i++) {
    const c = h[i];
    if (q) { if (c === q) q = null; }
    else if (c === '"' || c === "'") { const prev = h[i - 1]; if (prev === "=" || isSpace(prev)) q = c; }
    else if (c === ">") return i;
  }
  return -1;
}
// タグとテキストの並びに分ける。script 等の中身は飛ばし、title の中身だけ text として残す
export function tokenize(html, maxTokens = 200000) {
  const h = String(html || ""); const low = lowerAscii(h);
  const toks = []; let i = 0, tpl = 0;
  const push = (x) => { if (tpl === 0 || (x.t === "close" && x.name === "template") || (x.t === "open" && x.name === "template")) toks.push(x); };
  while (i < h.length) {
    if (toks.length >= maxTokens) return { toks, complete: false };
    const lt = h.indexOf("<", i);
    if (lt < 0) { push({ t: "text", v: h.slice(i) }); break; }
    if (lt > i) push({ t: "text", v: h.slice(i, lt) });
    if (low.startsWith("<!--", lt)) { const e = h.indexOf("-->", lt + 4); i = e < 0 ? h.length : e + 3; continue; }
    if (h[lt + 1] === "!" || h[lt + 1] === "?") { const e = h.indexOf(">", lt); i = e < 0 ? h.length : e + 1; continue; }
    const close = h[lt + 1] === "/";
    let k = lt + (close ? 2 : 1);
    if (!/[A-Za-z]/.test(h[k] || "")) { push({ t: "text", v: "<" }); i = lt + 1; continue; }
    let e = k; while (e < h.length && /[A-Za-z0-9-]/.test(h[e])) e++;
    const name = low.slice(k, e);
    const gt = tagEnd(h, e);
    if (gt < 0) return { toks, complete: false };       // 閉じない開始タグ以降は読めない
    if (close) { if (name === "template" && tpl > 0) tpl--; else push({ t: "close", name }); i = gt + 1; continue; }
    if (name === "template") { tpl++; i = gt + 1; continue; }   // template の中身は表示されないので、入れ子を数えて飛ばす
    if (name === "plaintext") break;                    // 以降はすべて文字として表示される（リンクにならない）
    push({ t: "open", name, a: parseAttrs(h.slice(e, gt)) });
    i = gt + 1;
    if (RAW.has(name)) {                                // 中身は「</名前」＋空白か > で終わる
      let j = i, stop = -1;
      while (true) {
        const c = low.indexOf("</" + name, j);
        if (c < 0) break;
        const nx = h[c + 2 + name.length] || ">";
        if (nx === ">" || isSpace(nx) || nx === "/") { stop = c; break; }
        j = c + 2;
      }
      const inner = stop < 0 ? h.slice(i) : h.slice(i, stop);
      if (name === "title") push({ t: "text", v: inner, title: true });
      if (stop < 0) break;
      const g2 = h.indexOf(">", stop); i = g2 < 0 ? h.length : g2 + 1;
      push({ t: "close", name });
    }
  }
  return { toks, complete: true };
}
const clean = (s) => unescape(String(s || "")).replace(/\s+/g, " ").trim();
// 互換用（テストで使う）：script/style/コメントを除いた本文
export function stripBlocks(h) { return tokenize(h).toks.filter((x) => x.t === "text" && !x.title).map((x) => x.v).join(""); }

// ---------- 判定 ----------
const PREF = "北海道|青森|岩手|宮城|秋田|山形|福島|茨城|栃木|群馬|埼玉|千葉|東京|神奈川|新潟|富山|石川|福井|山梨|長野|岐阜|静岡|愛知|三重|滋賀|京都|大阪|兵庫|奈良|和歌山|鳥取|島根|岡山|広島|山口|徳島|香川|愛媛|高知|福岡|佐賀|長崎|熊本|大分|宮崎|鹿児島|沖縄";
// 「千葉県」「習志野市」「港区」は後ろに地名が続いてもよい。「村・町・郡」で終わる語と、県名だけ（千葉）は
// 「田村税理士事務所」「千葉会計」のような姓を拾うので、直後が漢字のときは数えない
const AREA = new RegExp("(?:" + PREF + ")(?:都|道|府|県)|(?:" + PREF + ")(?![一-龥々])|[一-龥々ヶ]{1,4}[市区]|[一-龥々ヶ]{1,4}[町村郡](?![一-龥々])");
const SVC = /顧問|税理士変更|会社設立|法人設立|創業|起業|融資|補助金|助成金|相続|確定申告|記帳|決算|経営|給与|年末調整/;
const NOT_SVC = /ブログ|コラム|ニュース|お知らせ|新着|記事|実績|事例/;
// お知らせ・記事へのリンクを業務のページと数えない（題名に「相続」「経営」が入っていても記事は記事）
const NOT_SVC_PATH = /\/(news|blog|column|columns|topics|info|information|archives?|post|posts|entry|entries|category|tag|tags)(\/|$|[-_.])|\/(お知らせ|ニュース|ブログ|コラム)/i;
const CTA = /問い?合わ?せ|お問合|ご相談|無料相談|相談する|面談|予約/;
const LINE_HOST = /^(line\.me|lin\.ee|page\.line\.me|liff\.line\.me)$/i;

export function analyze(html, pageUrl) {
  const { toks, complete } = tokenize(html);
  if (!complete) return null;                          // 途中までしか読めなければ診断しない
  const base0 = new URL(pageUrl);
  // <base href> があれば、相対リンクはそこを起点に解く（同じサイトかどうかは取得したページで判断）
  let base = base0;
  for (const x of toks) { if (x.t === "open" && x.name === "base" && x.a.href) { try { base = new URL(x.a.href, base0); } catch {} break; } }
  const host = base0.hostname.replace(/^www\./, "");
  const abs = (href) => { try { return new URL(href, base); } catch { return null; } };
  let title = "", viewport = false, tel = false, line = false, contact = false;
  const svc = new Set();
  const doneLink = (href0, label) => {
    // 前後の制御文字・空白は、前から／後ろから数えて落とす（$ 付きの正規表現は長い空白で遅くなる）
    let href = String(href0 || "").replace(/[\t\n\r]/g, ""), st = 0, en = href.length;
    while (st < en && href.charCodeAt(st) <= 0x20) st++;
    while (en > st && href.charCodeAt(en - 1) <= 0x20) en--;
    href = href.slice(st, en);
    if (/^tel:/i.test(href)) tel = true;
    const u = /^[a-z][a-z0-9+.-]*:/i.test(href) && !/^https?:/i.test(href) ? null : abs(href);
    if (u && /^https?:$/.test(u.protocol) && LINE_HOST.test(u.hostname)) line = true;
    if (/^mailto:/i.test(href) || (CTA.test(label) && href && !/^#?$/.test(href) && !/^javascript:/i.test(href))) contact = true;
    if (!u || !SVC.test(label) || NOT_SVC.test(label) || label.length > 24 || /^\d{4}[./年-]/.test(label)) return;
    if (!/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, "") !== host) return;
    let p = u.pathname;
    try { p = decodeURIComponent(p); } catch {}
    p = p.replace(/\/$/, "");
    if (p && p !== "/index.html" && !NOT_SVC_PATH.test(p)) svc.add(p);
  };
  let link = null, form = null;
  for (const x of toks) {
    if (x.t === "text") {
      if (x.title) { if (!title) title = clean(x.v); continue; }
      if (link) link.label += x.v;
      continue;
    }
    if (x.t === "open") {
      if (x.name === "meta" && lowerAscii(x.a.name || "") === "viewport" && /(^|[\s,;])width\s*=\s*device-width\s*($|[,;\s])/i.test(x.a.content || "")) viewport = true;
      if (x.name === "a") { if (link) doneLink(link.href, clean(link.label)); link = { href: x.a.href || "", label: "" }; }
      if (x.name === "img" && link && x.a.alt) link.label += " " + x.a.alt;
      if (x.name === "form") form = { search: lowerAscii(x.a.role || "") === "search" || /search|\?s=|\/s\/?$/.test(lowerAscii(x.a.action || "")), fields: 0 };
      if (form && (x.name === "input" || x.name === "textarea" || x.name === "select")) {
        const type = lowerAscii(x.a.type || "text"), nm = lowerAscii(x.a.name || "");
        if (type === "search" || ["s", "q", "keyword", "keywords", "search", "query"].includes(nm)) form.search = true;
        else if (!["hidden", "submit", "button", "image", "reset"].includes(type)) form.fields++;
      }
      continue;
    }
    if (x.t === "close") {
      if (x.name === "a" && link) { doneLink(link.href, clean(link.label)); link = null; }
      if (x.name === "form" && form) { if (!form.search && form.fields > 0) contact = true; form = null; }
    }
  }
  if (link) doneLink(link.href, clean(link.label));
  if (form && !form.search && form.fields > 0) contact = true;
  return { viewport, https: base0.protocol === "https:", tel, line, titleArea: AREA.test(title), pages: svc.size, contact };
}

// 文面は「今回読んだトップページで、見つかった／見つからなかった」に留める（断定しない）
// ---------- 返すカード（Flex Message）。1行18字以内を目安に、言葉の切れ目で改行 ----------
const C = { navy: "#0E1A33", ink: "#222222", sub: "#3F4A5A", gray: "#5A6577", line: "#8A94A3", green: "#06C755" };
const T = (text, o = {}) => ({ type: "text", text, wrap: true, size: "sm", color: C.ink, ...o });
// 見つかった点（重い順）。title は短く、why は「直すと何が良くなるか」
const ITEMS = [
  ["viewport", () => "スマホ表示の設定が見当たりません", "スマホで文字が小さくならず、読みやすくなります"],
  ["https", () => "httpsで表示されていません", "ブラウザに「保護されていない通信」と出なくなります"],
  ["contact", () => "問い合わせへの案内が見当たりません", "相談したい方が、迷わずお問い合わせに進めます"],
  ["titleArea", () => "タイトルに地域名が見当たりません", "「〇〇市 税理士」など、近くの税理士を探している方の検索結果の表示に影響します"],
  ["pages", (r) => (r.pages === 1 ? "業務ページへの案内が1件のみです" : "業務ページへの案内が見当たりません"), "「相続 税理士」など、業務名で探している方の入口になります"],
  ["tel", () => "電話番号を押して発信できません", "スマホから、その場でお電話いただけるようになります"],
  ["line", () => "LINEなどの質問窓口が見当たりません", "電話の前に聞きたい方も、気軽にご相談いただけます"],
];
export function findIssues(r) {
  return ITEMS.filter(([k]) => (k === "pages" ? r.pages < 2 : !r[k])).map(([, title, why]) => [title(r), why]);
}
const Q = [
  { q: "ホームページの更新は、\nどのくらいの頻度ですか。", a: ["月に1回以上", "数か月に1回", "1年以上更新していない", "分からない"] },
  { q: "ここ半年の、ホームページからの\n顧問契約のお問い合わせ件数に\nご満足されていますか。", a: ["満足している", "もう少し増やしたい", "ほとんど来ていない", "分からない"] },
];
const LV_FEW = "ホームページからのご相談を\n増やせる余地が大きいと考えられます。";   // 「大」で、見つかった点が2つ以下のとき
const LV = {
  "大": "改善できる点が多く、\nホームページからのご相談を\n増やせる余地が大きいと考えられます。",
  "中": "いくつか改善できる点があり、\nご相談を増やせる余地が\nあると考えられます。",
  "小": "基本の点はよく整っています。\n近くの事務所との違いなど、\n自動では分からない点を\n詳しく拝見いたします。",
};
// 2問目で「満足している」→ 点数によらず「中」。今の状態を認めたうえで、この先の話にお誘いする
const SAT = "お問い合わせにはご満足とのことで、\n安心いたしました。\n改善できる点はいくつかございます。\nこの先どう伸ばしていくかを、\n一度ご相談できればと存じます。";

function row(label, sub, action) {
  const left = { type: "box", layout: "vertical", flex: 1, contents: [T(label, { weight: "bold", color: C.navy, size: "md" })] };
  if (sub) left.contents.push(T(sub, { size: "xs", color: C.gray, margin: "xs" }));
  return { type: "box", layout: "horizontal", paddingAll: "14px", action, contents: [left, { type: "text", text: "›", flex: 0, size: "lg", color: C.green, gravity: "center" }] };
}
function listCard(head, question, rows, alt) {
  const body = [{ type: "box", layout: "vertical", paddingAll: "14px", contents: [T(head, { size: "xs", weight: "bold", color: C.gray })] }];
  if (question) body.push({ type: "separator" }, { type: "box", layout: "vertical", paddingAll: "14px", contents: [T(question, { size: "md", weight: "bold", color: "#111111" })] });
  for (const r of rows) body.push({ type: "separator" }, r);
  return { type: "flex", altText: alt, contents: { type: "bubble", size: "mega", body: { type: "box", layout: "vertical", paddingAll: "0px", contents: body } } };
}
export function diagCard(issues) {
  const shown = issues.slice(0, 3);
  const c = [
    T("ご依頼ありがとうございます。\nホームページを拝見いたしました。\nトップページから分かった点を\nお送りいたします。"),
  ];
  if (shown.length) {
    c.push(T("【改善できる点】" + issues.length + "つ", { weight: "bold", color: C.navy, margin: "lg" }));
    for (const [title, why] of shown) {
      c.push({ type: "box", layout: "vertical", margin: "md", contents: [
        { type: "box", layout: "horizontal", contents: [T("■", { flex: 0, weight: "bold", color: "#111111" }), T(title, { flex: 1, weight: "bold", color: "#111111", margin: "sm" })] },
        { type: "box", layout: "horizontal", margin: "xs", contents: [T("└", { flex: 0, color: C.line }), T(why, { flex: 1, color: C.sub, margin: "sm" })] },
      ] });
    }
    if (issues.length > shown.length) c.push(T("ほか" + (issues.length - shown.length) + "点は、詳しいレポートで\nお伝えいたします。", { size: "xs", color: C.gray, margin: "md" }));
  } else {
    c.push(T("基本の7項目は、そろっていました。", { weight: "bold", color: C.navy, margin: "lg" }));
  }
  c.push(T("続いて、2点お伺いします。", { weight: "bold", margin: "lg" }));
  const alt = shown.length ? "簡易診断：改善できる点" + issues.length + "つ" : "簡易診断：基本の項目はそろっていました";
  return { type: "flex", altText: alt, contents: { type: "bubble", size: "mega", body: { type: "box", layout: "vertical", contents: c } } };
}
// 質問カード。答えは postback のデータに入れて次へ渡す（n=見つかった点の数、q1=1問目の答え）
export function questionCard(no, n, q1) {
  const q = Q[no - 1];
  const rows = q.a.map((label, i) => row(label, null, {
    type: "postback", label, displayText: label,
    data: no === 1 ? "qd=1&n=" + n + "&a=" + i : "qd=2&n=" + n + "&q1=" + q1 + "&a=" + i,
  }));
  return listCard("ご質問 " + no + "/2", q.q, rows, "ご質問 " + no + "/2：" + q.q.replace(/\n/g, ""));
}
// 2問目が「満足している」だけ「中」、それ以外は「大」（11/12 Takeru）
export function level(n, q1, a) {
  return a === 0 ? "中" : "大";
}
export function resultCard(n, q1, a) {
  const lv = level(n, q1, a);
  return { type: "flex", altText: "簡易診断の結果：改善の可能性 " + lv, contents: { type: "bubble", size: "mega",
    header: { type: "box", layout: "vertical", backgroundColor: C.green, paddingAll: "16px", contents: [
      T("簡易診断の結果", { size: "xs", weight: "bold", color: "#E6FFF0" }),
      T("改善の可能性：" + lv, { size: "xl", weight: "bold", color: "#FFFFFF", margin: "sm" }),
    ] },
    body: { type: "box", layout: "vertical", contents: [
      T(a === 0 ? SAT : n >= 3 ? LV[lv] : LV_FEW),
      T("近くの税理士事務所と比べた\n詳しいレポート（PDF）を、\n1営業日以内にお送りいたします。", { margin: "lg" }),
      T("詳しい分析と、手を付ける順番は、\n無料の15分面談でご説明いたします。\nよろしければ、一度お話しの機会を\nいただけますと幸いです。", { margin: "lg" }),
    ] },
    footer: { type: "box", layout: "vertical", contents: [
      { type: "button", style: "primary", color: C.green, action: { type: "uri", label: "無料の15分面談を予約", uri: BOOK } },
    ] },
  } };
}
export function greetCard() {
  return { type: "flex", altText: "ホームページの、どこから直すとよいか（無料診断）", contents: { type: "bubble", size: "mega",
    hero: { type: "image", url: CARD_IMG, size: "full", aspectRatio: "65:43", aspectMode: "cover" },
    body: { type: "box", layout: "vertical", contents: [
      T("ホームページの、\nどこから直すとよいか", { size: "lg", weight: "bold", color: "#111111" }),
      T("先に直す3点と、直した後の\n点数の目安を、無料でお届けします。\n診断だけでも大丈夫です。", { color: C.sub, margin: "md" }),
    ] },
    footer: { type: "box", layout: "vertical", spacing: "sm", contents: [
      { type: "button", style: "primary", color: C.green, action: { type: "message", label: "無料診断を受ける", text: "無料診断" } },
      { type: "button", style: "secondary", action: { type: "message", label: "気になる点を質問する", text: "デモの質問" } },
    ] },
  } };
}
export function startMsg() {
  return { type: "text", text: MSG.start, quickReply: { items: [{ type: "action", action: { type: "message", label: "1つ前に戻る", text: "最初に戻る" } }] } };
}
// 決まった言葉への返事（Webhook で返すもの）。それ以外は null
export function fixedReply(t) {
  if (t === "デモの質問") return [MSG.ask, askCard()];
  if (t === "無料診断") return [startMsg()];
  if (t === "最初に戻る") return [greetCard()];
  return null;
}
// デモ・レポートを見た方の質問（縦一覧）。答えの文は管理画面の応答メッセージが返す
export function askCard() {
  const rows = [
    row("費用と契約", "月額・初期費用・契約の期間", { type: "message", label: "費用と契約", text: "費用と契約" }),
    row("先生の手間", "お願いする作業と時間", { type: "message", label: "先生の手間", text: "先生の手間" }),
    row("15分の説明を予約", "日時を選ぶページが開きます", { type: "uri", label: "15分の説明を予約", uri: BOOK }),
    row("そのほかの質問", "トークに書いて送る", { type: "message", label: "そのほかの質問", text: "ほかの質問" }),
    { type: "box", layout: "horizontal", paddingAll: "14px", action: { type: "message", label: "1つ前に戻る", text: "最初に戻る" },
      contents: [T("‹ 1つ前に戻る", { color: C.gray })] },
  ];
  return listCard("デモ・レポートについてのご質問", null, rows, "デモ・レポートについてのご質問");
}
// 質問の答え（postback）。データは利用者の端末から来るので、形と範囲を確かめてから使う
export function handlePostback(data) {
  const m = /^qd=([12])&n=([0-7])(?:&q1=([0-3]))?&a=([0-3])$/.exec(String(data || ""));
  if (!m) return null;
  const n = +m[2], a = +m[4];
  if (m[1] === "1") return m[3] === undefined ? [questionCard(2, n, a)] : null;
  if (m[3] === undefined) return null;
  return [resultCard(n, +m[3], a)];
}

// ---------- 連投の歯止め（同じ人が短時間に何度も送った場合。1台の中だけの簡易な制限） ----------
const seen = new Map();
export function tooMany(userId, now = Date.now()) {
  if (!userId) return false;
  const arr = (seen.get(userId) || []).filter((t) => now - t < 10 * 60 * 1000).slice(-10);
  const over = arr.length >= 5;
  if (!over) arr.push(now);
  seen.delete(userId); seen.set(userId, arr);
  while (seen.size > 2000) seen.delete(seen.keys().next().value);
  return over;
}

export async function handleText(textIn, userId, deadline = Date.now() + SITE_MS) {
  const t = String(textIn || "").trim();
  if (KEYWORDS.has(t)) return null;                 // 管理画面の応答メッセージに任せる
  const fixed = fixedReply(t);
  if (fixed) return fixed;
  const url = findUrl(t);
  if (!url) return [MSG.fallback];
  if (tooMany(userId)) return [MSG.busy];
  if (deadline - Date.now() < MIN_SITE_MS) return [MSG.busy];
  return diagnose(url, deadline);
}

export async function diagnose(url, deadline) {
  if (deadline - Date.now() < MIN_SITE_MS) return [MSG.busy];
  const page = await fetchPage(url, deadline);
  if (!page) return [MSG.unread];
  const r = analyze(page.html, page.url);
  if (!r) return [MSG.unread];
  console.log("diag", JSON.stringify(r));           // 事務所が分かる情報（URL・ID）はログに出さない
  const issues = findIssues(r);
  return [diagCard(issues), { ...questionCard(1, issues.length), _later: true }];
}

const toMsg = (x) => (typeof x === "string" ? { type: "text", text: Array.from(x).slice(0, 4900).join("") } : (({ _later, ...m }) => m)(x));
async function lineApi(path, token, payload, ms, extra = {}) {
  if (ms < 300) return "fail";
  try {
    const res = await fetch("https://api.line.me" + path, {
      method: "POST", signal: AbortSignal.timeout(ms),
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token, ...extra },
      body: JSON.stringify(payload),
    });
    if (res.ok || res.status === 409) return "ok";
    console.log("line api failed", path, res.status);
    return res.status >= 500 ? "unknown" : "fail";
  } catch (e) { console.log("line api error", path, e && e.name); return "unknown"; }
}
export function retryKey(seed) {
  const h = crypto.createHash("sha256").update(String(seed)).digest("hex");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-4" + h.slice(13, 16) + "-" + ((parseInt(h[16], 16) & 3) | 8).toString(16) + h.slice(17, 20) + "-" + h.slice(20, 32);
}
const LATER_BUDGET = DELAY_MS + 2 * REPLY_MS + 1000;   // 診断の返信の後に、待ち＋プッシュ（再試行1回）に必要な時間
// 診断の後に質問1を送る：「入力中」を出し、少し待ってからプッシュ。結果が分からないときは同じキーで1回だけ再試行
async function sendLater(token, userId, msgs, end, key) {
  await lineApi("/v2/bot/chat/loading/start", token, { chatId: userId, loadingSeconds: 10 }, Math.min(1000, end - Date.now() - 2 * REPLY_MS));
  const wait = Math.max(0, Math.min(DELAY_MS, end - Date.now() - 2 * REPLY_MS));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const body = { to: userId, messages: msgs.map(toMsg) };
  let st = await lineApi("/v2/bot/message/push", token, body, Math.min(REPLY_MS, end - Date.now()), { "X-Line-Retry-Key": key });
  if (st === "unknown") st = await lineApi("/v2/bot/message/push", token, body, Math.min(REPLY_MS, end - Date.now()), { "X-Line-Retry-Key": key });
  if (st !== "ok") console.log("question1 not sent", st);
}
async function reply(token, replyToken, texts, ms = REPLY_MS) {
  return lineApi("/v2/bot/message/reply", token, { replyToken, messages: texts.slice(0, 5).map(toMsg) }, ms);
}

const doneEvents = new Map();
function firstTime(ev) {
  const id = ev && ev.webhookEventId;
  if (!id) return true;
  if (doneEvents.has(id)) return false;
  doneEvents.set(id, Date.now());
  while (doneEvents.size > 5000) doneEvents.delete(doneEvents.keys().next().value);
  return true;
}
export async function runEvents(events, token) {
  const end = Date.now() + TOTAL_MS;
  const evs = events.filter((ev) => ev && ev.replyToken && firstTime(ev) && ((ev.type === "message" && ev.message && ev.message.type === "text") || (ev.type === "postback" && ev.postback) || ev.type === "follow"));
  // 先に仕分ける：すぐ返せるもの（定型文・混雑）は最初にまとめて返し、時間がかかるサイトの読み込みは枠の数だけにする
  const canFetch = Math.max(1, Math.floor((TOTAL_MS - REPLY_MS) / (SITE_MS + REPLY_MS)) * PARALLEL);
  const quick = [], slow = [];
  for (const ev of evs) {
    if (ev.type === "follow") { quick.push([ev, [MSG.greet, greetCard()]]); continue; }
    if (ev.type === "postback") { const out = handlePostback(ev.postback.data); if (out) quick.push([ev, out]); continue; }
    const t = String(ev.message.text || "").trim();
    if (KEYWORDS.has(t)) continue;                    // 管理画面の応答メッセージに任せる
    const fixed = fixedReply(t);
    if (fixed) { quick.push([ev, fixed]); continue; }
    const url = findUrl(t), uid = ev.source && ev.source.userId;
    if (!url) quick.push([ev, [MSG.fallback]]);
    else if (slow.length >= canFetch || tooMany(uid)) quick.push([ev, [MSG.busy]]);
    else slow.push([ev, url]);
  }
  if (quick.length > slow.length && quick.length > 3) console.log("quick replies", quick.length, "fetch", slow.length);
  await Promise.all(quick.map(([ev, texts]) => reply(token, ev.replyToken, texts, Math.min(REPLY_MS, end - Date.now()))));
  const work = async () => {
    while (slow.length) {
      const [ev, url] = slow.shift();
      try {
        // イベントごとに取得の期限を決める（全体の期限から返信の時間を残す）
        const siteEnd = Math.min(Date.now() + SITE_MS, end - REPLY_MS);
        const texts = await diagnose(url, siteEnd);
        const src = ev.source || {};
        const delay = src.type === "user" && src.userId && end - Date.now() > REPLY_MS + LATER_BUDGET;
        const later = delay ? texts.filter((x) => x && x._later) : [];
        const st = await reply(token, ev.replyToken, delay ? texts.filter((x) => !(x && x._later)) : texts, Math.min(REPLY_MS, end - Date.now()));
        // 結果が分からない（タイムアウト・5xx）ときも送る：届いていれば正しい順、届いていなくても質問で会話が止まらない
        if (later.length && st !== "fail") pending.push(sendLater(token, src.userId, later, end, retryKey("q1:" + (ev.webhookEventId || ev.replyToken))));
        else if (later.length) console.log("diag reply not ok, question1 skipped", st);
      } catch (e) { console.log("event error", e && e.name); }
    }
  };
  const pending = [];
  await Promise.all(Array.from({ length: PARALLEL }, work));
  await Promise.all(pending);
}

export default async (req, context) => {
  try {
    if (req.method !== "POST") return new Response("ok");
    // 貼り付けで前後に空白・改行が入っても動くように、前後を落としてから使う
    const secret = (process.env.LINE_CHANNEL_SECRET || "").trim(), token = (process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();
    if (!secret || !token) return new Response("not configured", { status: 500 });
    const raw = Buffer.from(await req.arrayBuffer());
    if (!verify(raw, req.headers.get("x-line-signature"), secret)) return new Response("bad signature", { status: 401 });
    let data;
    try { data = JSON.parse(raw.toString("utf8")); } catch { return new Response("bad json", { status: 400 }); }
    const events = data && Array.isArray(data.events) ? data.events : [];
    const job = runEvents(events, token);
    // 先に200を返し、診断と返信は後ろで続ける（使えない環境では待ってから返す）
    if (context && typeof context.waitUntil === "function") { context.waitUntil(job); } else { await job; }
    return new Response("ok");
  } catch (e) {
    console.log("handler error", e && e.name);
    return new Response("ok");
  }
};
