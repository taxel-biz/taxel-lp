# -*- coding: utf-8 -*-
"""sitemap.xml に lastmod（更新日）を入れる・新しいページを足す。

使い方（リポジトリの直下で）:
    python tools/update_sitemap.py                       # 既存の lastmod は残し、無いURLだけ git の最終コミット日で埋める
    python tools/update_sitemap.py --touch keiei/foo/    # 中身を変えたページの lastmod を今日にする（複数可）
    python tools/update_sitemap.py --add keiei/foo/      # 新しいページを足す（lastmod は今日）

★ lastmod は「中身が変わった日」。CSSの差し替えなど見た目だけの変更では --touch しない。
"""
import datetime, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = "https://www.taxel.biz/"
TODAY = datetime.date.today().isoformat()


def git_date(path):
    f = os.path.join(path, "index.html") if not path.endswith(".html") else path
    r = subprocess.run(["git", "log", "-1", "--format=%cs", "--", f], cwd=ROOT, capture_output=True, text=True)
    return r.stdout.strip() or TODAY


def main():
    args = sys.argv[1:]
    touch = {a.strip("/") for i, a in enumerate(args) if i > 0 and args[i - 1] == "--touch"}
    add = list(dict.fromkeys(a.strip("/") for i, a in enumerate(args) if i > 0 and args[i - 1] == "--add"))
    for a in list(touch) + add:
        if not re.fullmatch(r"[a-z0-9_/-]*", a):
            sys.exit(f"URLのパスに使えない文字があります: {a}")
    p = os.path.join(ROOT, "sitemap.xml")
    s = open(p, encoding="utf-8").read()
    urls = re.findall(r"<url>.*?</url>", s, re.S)
    have = set()
    out = []
    for u in urls:
        loc = re.search(r"<loc>(.*?)</loc>", u).group(1)
        rel = loc.replace(SITE, "").strip("/")
        have.add(rel)
        lm = re.search(r"<lastmod>(.*?)</lastmod>", u)
        if rel in touch:
            date = TODAY
        elif lm:
            date = lm.group(1)
        else:
            date = git_date(rel or ".")
            if rel == "":
                date = git_date("index.html")
        u2 = re.sub(r"<lastmod>.*?</lastmod>", "", u)
        u2 = u2.replace("</loc>", f"</loc><lastmod>{date}</lastmod>", 1)
        out.append(u2)
    for rel in add:
        if rel in have:
            continue
        pr = "0.6"
        out.append(f"<url><loc>{SITE}{rel}/</loc><lastmod>{TODAY}</lastmod><changefreq>monthly</changefreq><priority>{pr}</priority></url>")
    head = s[: s.index("<url>")]
    tail = s[s.rindex("</url>") + len("</url>"):]
    s2 = head + "\n  ".join(out) + tail
    open(p, "w", encoding="utf-8", newline="\n").write(s2)
    print(f"{len(out)} URL（追加 {len([a for a in add if a not in have])}・今日に更新 {len(touch)}）")


if __name__ == "__main__":
    main()
