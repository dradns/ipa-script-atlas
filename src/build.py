# -*- coding: utf-8 -*-
"""Сборка data.js и аудио для атласа."""

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from atlas_data import LANGUAGES  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "assets" / "data.js"
AUDIO_DIR = ROOT / "assets" / "audio"

TTS_LANG = {"hi": "hi", "ur": "ur", "ar": "ar", "zh": "zh-CN"}

# ---------------------------------------------------------------------------
# Сравнительная таблица: один звук — четыре языка.
# Порядок групп и звуков задан вручную, чтобы атлас читался как справочник,
# а не как случайная выборка из четырёх инвентарей.
# ---------------------------------------------------------------------------

COMPARE_GROUPS = [
    ("Губные и губно-зубные", "губы и верхние зубы",
     ["p", "pʰ", "b", "bʱ", "m", "f", "ʋ", "w"]),
    ("Зубные и межзубные", "кончик языка у зубов или между ними",
     ["θ", "ð", "ðˤ", "t̪", "t̪ʰ", "d̪", "d̪ʱ", "n"]),
    ("Альвеолярные", "кончик языка у альвеол",
     ["t", "tʰ", "d", "tˤ", "dˤ", "s", "sˤ", "z", "ɾ", "r", "l", "ɫ"]),
    ("Ретрофлексные", "кончик языка оттянут назад",
     ["ʈ", "ʈʰ", "ɖ", "ɖʱ", "ɳ", "ɽ", "ɽʱ", "ʂ", "ʈ͡ʂ", "ʈ͡ʂʰ", "ʐ"]),
    ("Постальвеолярные и палатальные", "за альвеолами и у твёрдого нёба",
     ["t͡ʃ", "t͡ʃʰ", "d͡ʒ", "d͡ʒʱ", "ʃ", "ʒ", "t͡ɕ", "t͡ɕʰ", "ɕ", "j"]),
    ("Свистящие аффрикаты", "слитная смычка + щелевая фаза",
     ["t͡s", "t͡sʰ"]),
    ("Велярные и увулярные", "задняя часть языка и маленький язычок",
     ["k", "kʰ", "ɡ", "ɡʱ", "ŋ", "x", "ɣ", "q"]),
    ("Фарингальные и глоттальные", "глотка и голосовая щель",
     ["ħ", "ʕ", "ʔ", "h", "ɦ"]),
    ("Гласные", "слогообразующие звуки",
     ["ə", "a", "aː", "ɪ", "i", "iː", "ʊ", "u", "uː", "e", "eː", "ɛː",
      "o", "oː", "ɔː", "ɤ", "y", "ɚ", "ɹ̩", "ɻ̩", "aj", "aw"]),
]

# Для общих строк берём нейтральное описание: в разных языках один и тот же
# знак может обозначать зубную или альвеолярную реализацию.
MASTER_DESC = {
    "n": "переднеязычный носовой (зубной / альвеолярный)",
    "a": "краткий неогублённый гласный нижнего подъёма",
    "aː": "долгий неогублённый гласный нижнего подъёма",
    "i": "краткий неогублённый гласный переднего ряда верхнего подъёма",
    "iː": "долгий неогублённый гласный переднего ряда верхнего подъёма",
    "u": "краткий огублённый гласный заднего ряда верхнего подъёма",
    "uː": "долгий огублённый гласный заднего ряда верхнего подъёма",
}

LANG_ORDER = ["hi", "ur", "ar", "zh"]


def build_compare(languages):
    index = {}
    for lang in languages:
        for group in lang["groups"]:
            for row in group["rows"]:
                key = (lang["id"], row["ipa"])
                if key in index:
                    raise ValueError(f"duplicate sound {key}")
                index[key] = row

    seen = set()
    groups = []
    stats = {"total": 0, "common": 0, "consonants": 0, "vowels": 0}
    for title, hint, keys in COMPARE_GROUPS:
        rows = []
        for key in keys:
            lang_rows = {}
            for lid in LANG_ORDER:
                row = index.get((lid, key))
                if row:
                    lang_rows[lid] = row["id"]
            if not lang_rows:
                raise ValueError(f"comparison sound not found: {key}")
            first_id = next(iter(lang_rows.values()))
            first = next(r for r in index.values() if r["id"] == first_id)
            item = {
                "key": key,
                "ipa": key,
                "desc": MASTER_DESC.get(key, first["desc"]),
                "kind": first["kind"],
                "count": len(lang_rows),
                "rows": lang_rows,
            }
            rows.append(item)
            seen.add(key)
            stats["total"] += 1
            if len(lang_rows) == 4:
                stats["common"] += 1
            if item["kind"] == "vowel":
                stats["vowels"] += 1
            else:
                stats["consonants"] += 1
        groups.append({"title": title, "hint": hint, "rows": rows})

    all_unique = {key for (_lid, key) in index}
    missing = all_unique - seen
    extra = seen - all_unique
    if missing or extra:
        raise ValueError(f"comparison coverage mismatch: missing={missing}, extra={extra}")
    return {"groups": groups, "stats": stats}




def flatten():
    out = []
    langs = []
    for lang in LANGUAGES:
        lang = dict(lang)
        groups = []
        ci = 0
        for gi, (title, hint, rows) in enumerate(lang["groups"], 1):
            rows2 = []
            for ri, row in enumerate(rows, 1):
                ci += 1
                row = dict(row)
                row["id"] = f"{lang['id']}-c{ci:02d}"
                row["kind"] = "consonant"
                row["group"] = title
                row["audio"] = f"assets/audio/{row['id']}.mp3"
                row["audioText"] = row["example"]
                rows2.append(row)
                out.append((lang["id"], row))
            groups.append({"title": title, "hint": hint, "rows": rows2})
        vowels = []
        for ri, row in enumerate(lang["vowels"], 1):
            row = dict(row)
            row["id"] = f"{lang['id']}-v{ri:02d}"
            row["kind"] = "vowel"
            row["group"] = "Гласные"
            row["audio"] = f"assets/audio/{row['id']}.mp3"
            row["audioText"] = row["example"]
            vowels.append(row)
            out.append((lang["id"], row))
        groups.append({"title": "Гласные", "hint": "слогообразующие звуки", "rows": vowels, "vowels": True})
        lang["groups"] = groups
        lang["consonantCount"] = sum(1 for g in groups if not g.get("vowels") for _ in g["rows"])
        lang["vowelCount"] = len(vowels)
        lang["soundCount"] = lang["consonantCount"] + lang["vowelCount"]
        langs.append(lang)
    return langs, out


def write_data(languages):
    total = sum(l["soundCount"] for l in languages)
    payload = {
        "generated": time.strftime("%Y-%m-%d"),
        "totalSounds": total,
        "languages": languages,
        "compare": build_compare(languages),
    }
    js = "/* Автогенерация: src/build.py + src/atlas_data.py */\nwindow.ATLAS = "
    js += json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    js += ";\n"
    DATA_JS.parent.mkdir(parents=True, exist_ok=True)
    DATA_JS.write_text(js, encoding="utf-8")
    print(f"data.js: {len(js)/1024:.0f} KB, {total} звуков")


def download_tts(text, lang, dest: Path):
    params = urllib.parse.urlencode({
        "ie": "UTF-8",
        "q": text,
        "tl": TTS_LANG[lang],
        "client": "tw-ob",
    })
    url = "https://translate.google.com/translate_tts?" + params
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Referer": "https://translate.google.com/",
    })
    data = urllib.request.urlopen(req, timeout=25).read()
    if len(data) < 1200 or not data.startswith(b"\xff\xf3") and not data.startswith(b"ID3"):
        raise ValueError(f"unexpected audio bytes: {len(data)}")
    dest.write_bytes(data)


def build_audio(rows, force=False):
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    todo = [(lang, row) for lang, row in rows if force or not (AUDIO_DIR / f"{row['id']}.mp3").exists()]
    print(f"аудио: {len(todo)} из {len(rows)}")
    failed = []
    for i, (lang, row) in enumerate(todo, 1):
        dest = AUDIO_DIR / f"{row['id']}.mp3"
        ok = False
        for attempt in range(3):
            try:
                download_tts(row["example"], lang, dest)
                ok = True
                break
            except Exception as exc:  # noqa: BLE001
                if attempt == 2:
                    failed.append((row["id"], row["example"], str(exc)))
                time.sleep(0.8)
        if ok:
            print(f"  [{i:03d}/{len(todo)}] {row['id']}  {row['example']}  {dest.stat().st_size}b")
        time.sleep(0.22)
    if failed:
        print("НЕ СКАЧАЛОСЬ:")
        for f in failed:
            print("  ", f)
    return failed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", action="store_true", help="скачать аудио примеров")
    ap.add_argument("--force-audio", action="store_true", help="перекачать даже существующие файлы")
    ap.add_argument("--only", help="только один язык: hi/ur/ar/zh")
    args = ap.parse_args()
    languages, rows = flatten()
    if args.only:
        languages = [l for l in languages if l["id"] == args.only]
        rows = [x for x in rows if x[0] == args.only]
    write_data(languages)
    if args.audio:
        build_audio(rows, force=args.force_audio)


if __name__ == "__main__":
    main()
