# -*- coding: utf-8 -*-
"""Try to pull one freely licensed photo per location from Wikimedia Commons.

Best effort only: anything that fails is skipped and the PDF falls back to a
placeholder box for that entry.
"""
import json
import os
import sys

import requests

from data import ALL_POINTS

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")
API = "https://commons.wikimedia.org/w/api.php"
UA = "RhodesWeekendGuide/1.0 (personal travel guide; contact: local)"
TIMEOUT = 20
THUMB_W = 900

session = requests.Session()
session.headers.update({"User-Agent": UA})


def search_images(query, limit=8):
    params = {
        "action": "query", "format": "json", "formatversion": "2",
        "generator": "search", "gsrsearch": f"filetype:bitmap {query}",
        "gsrnamespace": "6", "gsrlimit": str(limit),
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata",
        "iiurlwidth": str(THUMB_W),
    }
    r = session.get(API, params=params, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json().get("query", {}).get("pages", []) or []


def usable(page):
    ii = (page.get("imageinfo") or [{}])[0]
    if ii.get("mime") not in ("image/jpeg", "image/png"):
        return False
    if ii.get("width", 0) < 700:
        return False
    meta = ii.get("extmetadata", {})
    lic = (meta.get("LicenseShortName", {}).get("value") or "").lower()
    # Commons is free by policy; reject only explicit fair-use leftovers.
    return "fair use" not in lic and "non-free" not in lic


def credit(page):
    ii = (page.get("imageinfo") or [{}])[0]
    meta = ii.get("extmetadata", {})
    lic = meta.get("LicenseShortName", {}).get("value") or "Wikimedia Commons"
    art = meta.get("Artist", {}).get("value") or ""
    import re
    art = re.sub(r"<[^>]+>", "", art).strip()
    art = " ".join(art.split())[:60]
    return f"{art} / {lic}".strip(" /") if art else lic


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for p in ALL_POINTS:
        got = False
        for q in p["queries"]:
            try:
                pages = search_images(q)
            except Exception as e:
                print(f"  ! search failed [{p['slug']}] {q}: {type(e).__name__}", file=sys.stderr)
                continue
            for page in pages:
                if not usable(page):
                    continue
                ii = page["imageinfo"][0]
                url = ii.get("thumburl") or ii.get("url")
                path = os.path.join(OUT, p["slug"] + ".jpg")
                try:
                    resp = session.get(url, timeout=TIMEOUT)
                    resp.raise_for_status()
                    with open(path, "wb") as fh:
                        fh.write(resp.content)
                except Exception as e:
                    print(f"  ! download failed [{p['slug']}]: {type(e).__name__}", file=sys.stderr)
                    continue
                manifest[p["slug"]] = {
                    "file": os.path.basename(path),
                    "credit": credit(page),
                    "page": page.get("title", ""),
                }
                print(f"  + {p['slug']}: {page.get('title')}")
                got = True
                break
            if got:
                break
        if not got:
            print(f"  - {p['slug']}: no image, placeholder will be used")
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=1, ensure_ascii=False)
    print(f"\n{len(manifest)}/{len(ALL_POINTS)} images fetched")


if __name__ == "__main__":
    main()
