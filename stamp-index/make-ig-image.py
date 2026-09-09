# -*- coding: utf-8 -*-
"""スタンプの素材PNGを、そのまま投稿できる 1080×1350（4:5）のクリーム地に整える。

`images_instagram` が用意されていないセット（2024年ぶんの多く）用。
素材は2種類あるので自動で見分ける：
  - alpha=Blend  … 透過ずみのスタンプ本体 → そのままクリーム地に置く
  - alpha=Undefined … 地色つきで書き出されたもの → 角の色を拾ってトリム＋標準クリームに置換

使い方:
  python3 make-ig-image.py <素材フォルダ> <出力フォルダ>
  例) python3 make-ig-image.py ".../202410トイプー家族スタンプ/imagesx3" ./out
"""
import glob, os, re, subprocess, sys

STD = "#FFF7EF"          # images_instagram の実測地色
CANVAS = "1080x1350"     # 4:5。幅1080はBuffer→TikTokの上限でもある
FIT = "880x1010>"        # 余白を残して収める

def px(src, fmt):
    return subprocess.run(["magick", src, "-format", fmt, "info:"],
                          capture_output=True, text=True).stdout.strip()

def to_ig(src, out, unify=True):
    alpha = px(src, "%A")
    if alpha == "Undefined":
        bg = px(src, "%[pixel:p{2,2}]")           # 角の色＝その画像の地色
        pre = ["-fuzz", "3%", "-trim", "+repage"]
        # 地色を標準クリームへ。fuzzは狭めにして絵を巻き込まない
        post = ["-fuzz", "4%", "-fill", STD, "-opaque", bg] if unify else []
        ext = STD if unify else bg
    else:
        pre, post, ext = ["-trim", "+repage"], [], STD
    cmd = ["magick", src, *pre, *post, "-resize", FIT,
           "-background", ext, "-gravity", "center", "-extent", CANVAS,
           "-quality", "92", out]
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0, r.stderr[:100]

if __name__ == "__main__":
    if len(sys.argv) < 3: sys.exit(__doc__)
    src_dir, out_dir = sys.argv[1], sys.argv[2]
    os.makedirs(out_dir, exist_ok=True)
    # 🚨 imagesx3 には `01_upscayl_3x_...png` のようなAI拡大版が混ざっていることがある。
    #    番号がずれるので「NN.png」だけを拾う。
    srcs = [p for p in sorted(glob.glob(src_dir + "/*.png"))
            if re.fullmatch(r"\d{2}\.png", os.path.basename(p))]
    if not srcs: sys.exit("「NN.png」形式の素材が見つかりません: " + src_dir)
    ng = 0
    for s in srcs:
        ok, err = to_ig(s, os.path.join(out_dir, os.path.basename(s)))
        if not ok: ng += 1; print("NG", os.path.basename(s), err)
    print(f"{len(srcs)-ng}/{len(srcs)} 枚を {CANVAS} で書き出しました → {out_dir}")
