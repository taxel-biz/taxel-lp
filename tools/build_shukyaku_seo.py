"""検索用の集客改善ページ /shukyaku/ を、営業用 LP（/lp/shukyaku/・noindex）から作る。

LP を直したら、このスクリプトを実行し直す（/shukyaku/ を手で直さない）。
  python tools/build_shukyaku_seo.py           # 作り直す
  python tools/build_shukyaku_seo.py --check   # LP と食い違っていないか確かめる（push 前）

LP との違い
- index する（noindex を外す）・canonical / OG を付ける・title と説明文は検索用
- 最初の画面は n 版だけ（h1 は1つ）。?v= で別の版に切り替わらない
- 画像は /lp/shukyaku/img/ を参照する（コピーしない）
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "lp" / "shukyaku" / "index.html"
OUT = ROOT / "shukyaku" / "index.html"
URL = "https://www.taxel.biz/shukyaku/"

TITLE = "税理士事務所のホームページ制作・集客改善｜Googleマップ・公式LINEの運用まで ― taXel（タクセル）"
DESC = ("税理士事務所の集客を、ホームページ・Googleマップ・公式LINEから改善します。"
        "同じ地域の事務所と比べた無料診断から、毎月の制作と運用までお任せいただけます。")
H1 = "税理士事務所の集客を、<br>ホームページとGoogleマップから改善します"


def once(s, old, new, label):
    n = s.count(old)
    if n != 1:
        sys.exit(f"想定外：{label} が {n} 件（1件のはず）。LP の作りが変わったので、このスクリプトを直す")
    return s.replace(old, new)


def block_end(s, start):
    """start にある <div ...> に対応する </div> の直後の位置"""
    depth = 0
    for m in re.compile(r"<div[\s>]|</div>").finditer(s, start):
        depth += 1 if m.group() != "</div>" else -1
        if depth == 0:
            return m.end()
    sys.exit("想定外：div が閉じていない")


def main():
    s = SRC.read_text(encoding="utf-8")

    # head
    s = once(s, '<meta name="robots" content="noindex">', "", "noindex")
    s, n = re.subn(r"<title>[^<]*</title>", f"<title>{TITLE}</title>", s, count=1)
    if n != 1:
        sys.exit("想定外：title が見つからない")
    s, n = re.subn(r'<meta name="description" content="[^"]*">', f'<meta name="description" content="{DESC}">', s, count=1)
    if n != 1:
        sys.exit("想定外：description が見つからない")
    head_add = (
        f'<link rel="canonical" href="{URL}">'
        '<meta property="og:type" content="website"><meta property="og:site_name" content="taXel">'
        f'<meta property="og:title" content="{TITLE.split(" ― ")[0]}">'
        f'<meta property="og:description" content="{DESC}">'
        '<meta property="og:image" content="https://www.taxel.biz/ogp.png">'
        '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">'
        f'<meta property="og:url" content="{URL}"><meta property="og:locale" content="ja_JP">'
        '<meta name="twitter:card" content="summary_large_image">'
        '<meta name="twitter:image" content="https://www.taxel.biz/ogp.png">'
    )
    s = once(s, "</head>", head_add + "</head>", "</head>")

    # 最初の画面：n 版だけ残す（o/a/b/c を落とす）。div の入れ子を数えて、各版の範囲だけを消す
    ms = list(re.finditer(r'<div class="fv" data-fv="([a-z])">', s))
    names = [m.group(1) for m in ms]
    if sorted(names) != ["a", "b", "c", "n", "o"]:
        sys.exit(f"想定外：最初の画面の版が {names}（各1つずつのはず）")
    drop = [(m.start(), block_end(s, m.start())) for m in ms if m.group(1) != "n"]
    for a, b in reversed(drop):
        s = s[:a] + s[b:]
    s = once(s, '<div class="fv" data-fv="n">', '<div class="fv on" data-fv="n">', "n 版")
    s = once(s, 'KEYS = ["o","a","b","c","n"]', 'KEYS = ["n"]', "KEYS")

    # h1 を検索用に
    a = s.index('<div class="fv on" data-fv="n">')
    b = block_end(s, a)
    blk = s[a:b]
    if blk.count("<h1>") != 1 or blk.count("</h1>") != 1:
        sys.exit("想定外：n 版の中の h1 が1つではない")
    blk = re.sub(r"<h1>.*?</h1>", lambda m: f"<h1>{H1}</h1>", blk, flags=re.S)
    s = s[:a] + blk + s[b:]

    # 画像は LP のものを参照
    s = re.sub(r'(src|href)="img/', r'\1="/lp/shukyaku/img/', s)

    if s.count("<h1") != 1:
        sys.exit(f"想定外：h1 が {s.count('<h1')} 件")
    if "noindex" in s:
        sys.exit("想定外：noindex が残っている")
    if re.search(r'(src|href)="img/', s):
        sys.exit("想定外：相対の img/ が残っている")

    if "--check" in sys.argv:
        cur = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if cur != s:
            sys.exit("NG：/shukyaku/ が LP から作り直されていない。python tools/build_shukyaku_seo.py を実行する")
        print("OK：/shukyaku/ は LP と一致")
        return
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(s, encoding="utf-8", newline="\n")
    print(f"書き出し: {OUT.relative_to(ROOT)}  ({len(s):,} 文字)")


if __name__ == "__main__":
    main()
