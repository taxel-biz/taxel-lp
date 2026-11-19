# -*- coding: utf-8 -*-
"""Tailwind の CSS を事前に作る（旧：ページごとに cdn.tailwindcss.com を実行時に読み込んでいた）。

使い方（リポジトリの直下で）:
    python tools/build_css.py          # CSS を作り直す
    python tools/build_css.py --check  # 作り直しが要るか確かめるだけ（要るなら終了コード1）

しくみ:
- 各ページの <link href="/assets/css/tw-<名前>.css"> を見て、どの設定で作るかを決める
- tools/tailwind/<名前>.config.js の設定で、そのCSSを使うページ＋assets/ のJSを読み取って作る
- ★ 新しいページを足したら、公開の前に必ずこれを実行してコミットする
  （CSSに無いクラスは効かない。Play CDN と違い、自動では足されない）
"""
import glob, os, re, shutil, subprocess, sys, tempfile, json, hashlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TW_VERSION = "3.4.17"
LINK_RE = re.compile(r"""href=["']/assets/css/tw-([a-z0-9-]+)\.css["']""")
# 読み込み方を変えたページが黙って対象から外れないよう、それらしい参照は全部拾って突き合わせる
ANY_TW_RE = re.compile(r'tw-[a-z0-9-]+\.css|cdn\.tailwindcss\.com')


def pages_by_css():
    groups = {}
    for f in glob.glob(os.path.join(ROOT, "**", "*.html"), recursive=True):
        if os.sep + "node_modules" + os.sep in f:
            continue
        with open(f, encoding="utf-8") as fh:
            text = fh.read()
        names = set(LINK_RE.findall(text))
        refs = ANY_TW_RE.findall(text)
        # 1ページ1つの tw-*.css を、決まった書き方で読み込む。それ以外の参照が混ざっていたら止める
        if len(names) > 1 or len(refs) != len(LINK_RE.findall(text)):
            sys.exit(f"Tailwind の読み込み方が想定外です（1ページに1つ、href=\"/assets/css/tw-<名前>.css\" の形だけにする）: {f}")
        if names:
            groups.setdefault(names.pop(), []).append(f)
    return groups


def tailwind_cmd():
    local = os.environ.get("TAILWIND_BIN")
    if local:
        return [local]
    npx = shutil.which("npx")
    if not npx:
        sys.exit("npx が見つかりません（Node.js を入れるか TAILWIND_BIN を指定）")
    return [npx, "--yes", f"tailwindcss@{TW_VERSION}"]


def build(name, files, out_path):
    cfg_src = os.path.join(ROOT, "tools", "tailwind", f"{name}.config.js")
    if not os.path.exists(cfg_src):
        sys.exit(f"設定がありません: {cfg_src}")
    with tempfile.TemporaryDirectory() as td:
        cfg = os.path.join(td, "tailwind.config.js")
        # ページに後から部品を差し込むJS（assets/nav.js など）のクラスも拾う
        scripts = glob.glob(os.path.join(ROOT, "assets", "**", "*.js"), recursive=True)
        content = json.dumps([p.replace("\\", "/") for p in sorted(files) + sorted(scripts)], ensure_ascii=False)
        with open(cfg, "w", encoding="utf-8") as fh:
            fh.write(f"const base = require({json.dumps(cfg_src.replace(chr(92), '/'))});\n")
            fh.write(f"module.exports = Object.assign({{}}, base, {{ content: {content} }});\n")
        cmd = tailwind_cmd() + ["-c", cfg, "-i", os.path.join(ROOT, "tools", "tailwind", "input.css"),
                                "-o", out_path, "--minify"]
        r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if r.returncode != 0:
            sys.exit(f"tailwind の実行に失敗: {name}\n{r.stderr[-2000:]}")


def digest(path):
    if not os.path.exists(path):
        return None
    with open(path, "rb") as fh:
        return hashlib.md5(fh.read()).hexdigest()


def main():
    check = "--check" in sys.argv
    groups = pages_by_css()
    if not groups:
        sys.exit("tw-*.css を読み込むページがありません")
    stale = []
    for name, files in sorted(groups.items()):
        out = os.path.join(ROOT, "assets", "css", f"tw-{name}.css")
        if check:
            with tempfile.TemporaryDirectory() as td:
                tmp = os.path.join(td, "out.css")
                build(name, files, tmp)
                if digest(tmp) != digest(out):
                    stale.append(name)
        else:
            build(name, files, out)
            print(f"tw-{name}.css: {len(files)}ページ・{os.path.getsize(out):,} bytes")
    if check:
        if stale:
            print("作り直しが要ります:", ", ".join(stale))
            sys.exit(1)
        print("CSSは最新です")


if __name__ == "__main__":
    main()
