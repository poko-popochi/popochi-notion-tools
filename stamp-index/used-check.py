# -*- coding: utf-8 -*-
"""過去のスタンプイラスト投稿で「すでに使ったカット」を洗い出す。

Notionのファイル名は「07.png」のように番号だけでセットが分からないので、
画像の中身（md5）でローカルのスタンプ素材と突き合わせる。
使い方: python3 used-check.py [開始日 YYYY-MM-DD]
"""
import glob, hashlib, json, os, re, subprocess, sys

TOKEN = re.search(r'NOTION_TOKEN=(\S+)',
                  open('/Users/poko/Projects/popochi-SNS-dashborad/.env.local').read()).group(1)
H = ["-H", f"Authorization: Bearer {TOKEN}", "-H", "Notion-Version: 2022-06-28"]
BASE = "/Volumes/GoogleDrive/Drive/Works/Popochi works/01_LINEスタンプ"
SINCE = sys.argv[1] if len(sys.argv) > 1 else "2026-01-01"

# 索引ずみのセット（stamp-index/sets/*.md と対応）
SETS = {
    # 2026
    "夏バテ":         "2026/20260622ぽぽちの夏バテスタンプ",
    "大人ぽぽち":     "2026/20260703ぽぽふれ大人ぽぽち",
    "かみなり":       "2026/20260818かみなりスタンプ",
    "くらげネガ":     "2026/20260831くらげのネガティブスタンプ",
    "トイプー":       "2026/20260917トイプーのきづかいスタンプ",
    "デカ文字褒め":   "2026/20260127デカ文字ぽぽち褒め",
    "気持ちぱぴち":   "2026/20260203気持ちを伝えるぱぴち",
    "悩めるくらげ":   "2026/20260217悩めるくらげ〜あいさつ",
    "猫の日":         "2026/20260222猫の日スタンプ",
    "春の新生活":     "2026/20260303ぽぽちの春の新生活",
    "文鳥新生活":     "2026/20260310文鳥さんの新生活スタンプ",
    "パンダ2":        "2026/20260414友好的なパンダ２",
    "夜しか寝れない": "2026/20260420夜しか寝れないスタンプ",
    "赤ちゃんぽぽち": "2026/20260430赤ちゃんぽぽち",
    "外食ごはん":     "2026/20260504ぽぽちのご飯スタンプ〜外食",
    "ラブラブぽめ":   "2026/20260519ラブラブぽめちゃんズ",
    "ぱぴスタンプ":   "2026/20260528ぱぴスタンプ",
    "無口なハム":     "2026/20260608無口なハムさん",
    "北海道":         "2026/20260720北海道のもふもふスタンプ",
    "超小さいパンダ": "2026/20260804超小さいパンダ",
    "文鳥豆苗":       "2026/20260908文鳥さんの豆苗ライフ",
    # 2025
    "春(花粉)":       "2025/20250300ぽぽちのお花いっぱい春スタンプ",
    "ニュースぱぴち": "2025/20250308ニュースキャスターぱぴち",
    "ひみつ2":        "2025/20250315ひみつのぽぽち２",
    "推し活":         "2025/20250325推し活スタンプ",
    "やる気ない文鳥": "2025/20250415やる気のない文鳥",
    "ボーダーコリー": "2025/20250430ボーダーコリー",
    "やる気ぱぴち":   "2025/20250515やる気を失ったぱぴち",
    "ごはん":         "2025/20250529ごはんスタンプ",
    "梅雨":           "2025/20250605梅雨スタンプ",
    "夏2025":         "2025/20250624夏スタンプ",
    "文鳥の夏":       "2025/20250708文鳥の夏",
    "手抜きご飯":     "2025/20250722手抜きご飯",
    "文鳥ニュース":   "2025/20250731文鳥ニュース",
    "だじゃれ":       "2025/20250814だじゃれぽぽち",
    "セキセイ":       "2025/20250902セキセイインコ",
    "イヤイヤ期":     "2025/20250916ぱぴちのイヤイヤ期",
    "ちいさいかみなり":"2025/20250923ちいさいかみなり",
    "くらげ2025":     "2025/20250925くらげスタンプ",
    "ハロウィン":     "2025/20251007ハロウィンスタンプ",
    "マラミュート":   "2025/20251028アラスカンマラミュート",
    "冬":             "2025/20251112ぽぽちの冬スタンプ",
    "あけおめ":       "2025/20251121ぽぽちあけおめスタンプ",
    "あけおめ文鳥":   "2025/20251122あけおめ文鳥",
    "ふわふわ(写真)": "2025/20251204ふわふわぽぽち",
    "寝正月":         "2025/20251222ぽぽちの寝正月",
    # 2024（索引ずみ・images_instagram があるもの）
    "今大丈夫?":      "2024/202403今大丈夫？",
    "学生":           "2024/202404学生ぽぽち",
    "ゴールデン":     "2024/202405ゴールデンレトリバー",
    "関西弁":         "2024/202405関西弁",
    "おふとん夏":     "2024/202406おふとん大好き_夏",
    "育児":           "2024/202406育児スタンプ",
    "秋":             "2024/202409ぽぽちの秋スタンプ",
    "やる気ないぽぽち":"2024/20241015やる気のないぽぽち",
    "あいづち":       "2024/20241024文鳥さんと小鳥のあいづちスタンプ",
    "やる気ないぽぽち2":"2024/20241219やる気のないぽぽち２",
}

def sh(a): return subprocess.run(a, capture_output=True).stdout

local = {}
for name, folder in SETS.items():
    for p in sorted(glob.glob(f"{BASE}/{folder}/images_instagram/*.png")):
        local[hashlib.md5(open(p, 'rb').read()).hexdigest()] = f"{name} #{os.path.basename(p)[:-4]}"
print(f"ローカル索引 {len(local)}枚 / {SINCE}以降の投稿を照合します\n")

# 対象ページの一覧は MCP 側で取れないのでページIDを引数ファイルから読む形にせず、
# データソースを検索APIで引く（内容に「スタンプイラスト」を含む行）
pages, cursor = [], None
while True:
    body = {"query": "スタンプイラスト", "filter": {"property": "object", "value": "page"}, "page_size": 100}
    if cursor: body["start_cursor"] = cursor
    r = json.loads(sh(["curl", "-s"] + H + ["-X", "POST", "https://api.notion.com/v1/search",
                                            "-H", "Content-Type: application/json", "-d", json.dumps(body)]))
    if "results" not in r: sys.exit("search failed: " + json.dumps(r, ensure_ascii=False)[:300])
    for p in r["results"]:
        pr = p.get("properties", {})
        t = pr.get("内容", {}).get("title", [])
        title = "".join(x.get("plain_text", "") for x in t)
        dt = (pr.get("公開日", {}).get("date") or {}).get("start", "")
        if "スタンプイラスト" in title and dt[:10] >= SINCE:
            pages.append((dt[:10], p["id"], pr))
    if not r.get("has_more"): break
    cursor = r["next_cursor"]

used, unknown = {}, 0
for d, pid, pr in sorted(pages, reverse=True):
    for f in pr.get("投稿画像", {}).get("files", []):
        url = f.get("file", {}).get("url")
        if not url: continue
        h = hashlib.md5(sh(["curl", "-sL", url])).hexdigest()
        m = local.get(h)
        if m: used.setdefault(m, []).append(d)
        else: unknown += 1

print(f"照合対象 {len(pages)}投稿 / 索引の5セットに一致しなかった画像 {unknown}枚（別セット or 加工ずみ）\n")
print("★ すでに使ったカット")
if not used: print("  なし")
for k in sorted(used): print(f"  {k:16} {'、'.join(sorted(used[k], reverse=True))}")
