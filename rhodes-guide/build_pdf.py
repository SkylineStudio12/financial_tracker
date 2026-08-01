# -*- coding: utf-8 -*-
"""Assemble rhodes-weekend.pdf."""
import json
import os

from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas as pdfcanvas

import theme as T
from data import (TITLE, INTRO, ENDNOTE, DAY1, DAY2, OPTIONAL,
                  DAY1_TITLE, DAY1_SUB, DAY2_TITLE, DAY2_SUB, OPT_TITLE, OPT_SUB)

HERE = os.path.dirname(os.path.abspath(__file__))
PHOTO_DIR = os.path.join(HERE, "photos")   # hand-supplied photos, named <slug>.<ext>
IMG_DIR = os.path.join(HERE, "images")     # whatever fetch_images.py managed to pull
CACHE = os.path.join(HERE, ".thumbs")
OUT = os.path.join(HERE, "rhodes-weekend.pdf")

PHOTO_EXT = (".jpg", ".jpeg", ".png", ".webp", ".JPG", ".JPEG", ".PNG", ".WEBP")

PW, PH = A4
ML = MR = 18 * mm
MT = 16 * mm
MB = 16 * mm
CW = PW - ML - MR

DISPLAY, BODY, BOLD, ITALIC = "Display", "Body", "Body-B", "Body-I"

try:
    MANIFEST = json.load(open(os.path.join(IMG_DIR, "manifest.json")))
except Exception:
    MANIFEST = {}

# optional {slug: "Author / License"} for the caption under each photo
try:
    CREDITS = json.load(open(os.path.join(PHOTO_DIR, "credits.json")))
except Exception:
    CREDITS = {}


def source_image(slug):
    """photos/<slug>.<ext> wins; otherwise whatever fetch_images.py downloaded."""
    for ext in PHOTO_EXT:
        p = os.path.join(PHOTO_DIR, slug + ext)
        if os.path.exists(p):
            return p
    entry = MANIFEST.get(slug)
    if entry:
        p = os.path.join(IMG_DIR, entry["file"])
        if os.path.exists(p):
            return p
    return None


def credit_for(slug):
    if slug in CREDITS:
        return CREDITS[slug]
    return MANIFEST.get(slug, {}).get("credit", "")


def register_fonts():
    pdfmetrics.registerFont(TTFont(DISPLAY, T.F_DISPLAY))
    pdfmetrics.registerFont(TTFont(BODY, T.F_BODY))
    pdfmetrics.registerFont(TTFont(BOLD, T.F_BODY_B))
    pdfmetrics.registerFont(TTFont(ITALIC, T.F_BODY_I))
    pdfmetrics.registerFontFamily(BODY, normal=BODY, bold=BOLD, italic=ITALIC,
                                  boldItalic=BODY)


def wrap(text, font, size, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if pdfmetrics.stringWidth(trial, font, size) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def text_block(c, x, y, text, font, size, leading, color, width):
    """Draw wrapped text with `y` as the top edge. Returns the height used."""
    c.setFont(font, size)
    c.setFillColor(color)
    lines = wrap(text, font, size, width)
    ty = y - size
    for ln in lines:
        c.drawString(x, ty, ln)
        ty -= leading
    return len(lines) * leading


def block_height(text, font, size, leading, width):
    return len(wrap(text, font, size, width)) * leading


def tracked(c, x, y, text, font, size, color, space=1.4):
    t = c.beginText(x, y)
    t.setFont(font, size)
    t.setFillColor(color)
    t.setCharSpace(space)
    t.textOut(text)
    t.setCharSpace(0)  # canvas text state is sticky; reset before it leaks
    c.drawText(t)


def tracked_width(text, font, size, space=1.4):
    return pdfmetrics.stringWidth(text, font, size) + space * len(text)


# ---------------------------------------------------------------- thumbnails

def photo(slug, w_px, h_px):
    """Center-cropped photo for a slug, or None when we have no image."""
    src = source_image(slug)
    if not src:
        return None
    os.makedirs(CACHE, exist_ok=True)
    dst = os.path.join(CACHE, f"{slug}-{w_px}x{h_px}.jpg")
    if not os.path.exists(dst):
        try:
            im = Image.open(src).convert("RGB")
        except Exception:
            return None
        sr, tr = im.width / im.height, w_px / h_px
        if sr > tr:
            nw = int(im.height * tr)
            im = im.crop(((im.width - nw) // 2, 0, (im.width + nw) // 2, im.height))
        else:
            nh = int(im.width / tr)
            im = im.crop((0, (im.height - nh) // 2, im.width, (im.height + nh) // 2))
        im.resize((w_px, h_px), Image.LANCZOS).save(dst, quality=88)
    return dst


def thumb(c, x, y, w, h, item, color, soft, number=None, radius=2.5 * mm):
    """Draw the photo, or a monogram placeholder tile when there is none.

    `y` is the top edge of the box.
    """
    box = (x, y - h, w, h)
    src = photo(item["slug"], int(w / mm * 12), int(h / mm * 12))
    c.saveState()
    p = c.beginPath()
    p.roundRect(*box, radius)
    c.clipPath(p, stroke=0, fill=0)
    if src:
        c.drawImage(src, *box, mask="auto")
    else:
        c.setFillColor(soft)
        c.rect(*box, stroke=0, fill=1)
        letter = item["map_label"][0].upper()
        size = h / mm * 1.55
        c.setFont(DISPLAY, size)
        c.setFillColor(color)
        c.setFillAlpha(0.16)
        c.drawCentredString(x + w / 2, y - h / 2 - size * 0.35, letter)
        c.setFillAlpha(1)
    c.restoreState()

    c.setStrokeColor(color if src else soft)
    c.setLineWidth(0.5)
    c.setDash(() if src else (1.6, 1.6))
    c.roundRect(*box, radius, stroke=1, fill=0)
    c.setDash()

    if number is not None:
        cx, cy, r = x + 7.2 * mm, y - 7.2 * mm, 4.3 * mm
        c.setFillColor("#FFFFFF")
        c.circle(cx, cy, r + 0.9 * mm, stroke=0, fill=1)
        c.setFillColor(color)
        c.circle(cx, cy, r, stroke=0, fill=1)
        c.setFillColor("#FFFFFF")
        c.setFont(BOLD, 10)
        c.drawCentredString(cx, cy - 3.5, str(number))

    if src and credit_for(item["slug"]):
        c.setFont(BODY, 5.6)
        c.setFillColor(T.FAINT)
        c.drawString(x, y - h - 3.1 * mm, credit_for(item["slug"])[:70])


# --------------------------------------------------------------- page frame

def page_background(c):
    c.setFillColor(T.PAPER)
    c.rect(0, 0, PW, PH, stroke=0, fill=1)


def footer(c, page):
    y = MB - 6 * mm
    c.setStrokeColor(T.RULE)
    c.setLineWidth(0.4)
    c.line(ML, y + 4.5 * mm, PW - MR, y + 4.5 * mm)
    c.setFont(BODY, 7.2)
    c.setFillColor(T.FAINT)
    c.drawString(ML, y, "Weekend în Rhodos")
    c.drawRightString(PW - MR, y, str(page))


# ------------------------------------------------------------------- blocks

ENTRY_TH_W, ENTRY_TH_H = 58 * mm, 40 * mm
ENTRY_GAP = 7 * mm
ENTRY_SPACING = 9 * mm
OPT_TH_W, OPT_TH_H = 34 * mm, 24 * mm
OPT_GAP = 6 * mm
OPT_SPACING = 6.5 * mm


def entry_height(item):
    tw = CW - ENTRY_TH_W - ENTRY_GAP
    h = 4.6 * mm  # time line
    h += block_height(item["name"], BOLD, 12, 15.2, tw)
    h += 1.8 * mm
    h += block_height(item["desc"], BODY, 9.4, 13.4, tw)
    h += 5.0 * mm  # coords
    return max(ENTRY_TH_H, h)


def draw_entry(c, y, item, color, soft):
    tw = CW - ENTRY_TH_W - ENTRY_GAP
    tx = ML + ENTRY_TH_W + ENTRY_GAP
    thumb(c, ML, y, ENTRY_TH_W, ENTRY_TH_H, item, color, soft, number=item["n"])

    ty = y
    tracked(c, tx, ty - 3.1 * mm, item["time"], BOLD, 8.2, color, 1.1)
    ty -= 6.2 * mm
    ty -= text_block(c, tx, ty + 1.5 * mm, item["name"], BOLD, 12, 15.2, T.INK, tw) - 1.5 * mm
    ty -= 1.4 * mm
    ty -= text_block(c, tx, ty, item["desc"], BODY, 9.4, 13.4, T.MUTED, tw)
    c.setFont(BODY, 7.4)
    c.setFillColor(T.FAINT)
    c.drawString(tx, ty - 3.4 * mm, "%.4f, %.4f" % (item["lat"], item["lon"]))
    return entry_height(item)


def opt_height(item):
    tw = CW - OPT_TH_W - OPT_GAP
    h = block_height(item["name"], BOLD, 10, 13.0, tw)
    h += 1.2 * mm
    h += block_height(item["desc"], BODY, 8.6, 12.2, tw)
    h += 4.6 * mm
    return max(OPT_TH_H, h)


def draw_opt(c, y, item):
    tw = CW - OPT_TH_W - OPT_GAP
    tx = ML + OPT_TH_W + OPT_GAP
    thumb(c, ML, y, OPT_TH_W, OPT_TH_H, item, T.OPT, T.OPT_SOFT, radius=2 * mm)
    ty = y
    ty -= text_block(c, tx, ty, item["name"], BOLD, 10, 13.0, T.INK, tw)
    ty -= 1.0 * mm
    ty -= text_block(c, tx, ty, item["desc"], BODY, 8.6, 12.2, T.MUTED, tw)
    c.setFont(BODY, 7.0)
    c.setFillColor(T.FAINT)
    c.drawString(tx, ty - 3.0 * mm, "%.4f, %.4f" % (item["lat"], item["lon"]))
    return opt_height(item)


DAY_HEADER_H = 26 * mm


def draw_day_header(c, y, title, sub, color):
    c.setFillColor(color)
    c.rect(ML, y - 3.4 * mm, 16 * mm, 1.6 * mm, stroke=0, fill=1)
    c.setFont(DISPLAY, 19)
    c.setFillColor(T.INK)
    c.drawString(ML, y - 13.6 * mm, title)
    c.setFont(ITALIC, 10.5)
    c.setFillColor(T.MUTED)
    c.drawString(ML, y - 19.4 * mm, sub)
    c.setStrokeColor(T.RULE)
    c.setLineWidth(0.5)
    c.line(ML, y - 23.2 * mm, PW - MR, y - 23.2 * mm)
    return DAY_HEADER_H


# -------------------------------------------------------------------- cover

def draw_cover(c):
    page_background(c)
    y = PH - MT

    tracked(c, ML, y - 6 * mm, "GHID DE WEEKEND · GRECIA", BOLD, 8, T.DAY1, 2.0)
    y -= 14 * mm

    c.setFont(DISPLAY, 26)
    c.setFillColor(T.INK)
    for line in wrap(TITLE, DISPLAY, 26, CW):
        c.drawString(ML, y - 26, line)
        y -= 33
    y -= 3 * mm

    used = text_block(c, ML, y, INTRO, BODY, 11, 16, T.MUTED, CW * 0.88)
    y -= used + 8 * mm

    img = Image.open(os.path.join(HERE, "map.png"))
    mw = CW
    mh = mw * img.height / img.width
    avail = y - (MB + 20 * mm)
    if mh > avail:
        mh = avail
        mw = mh * img.width / img.height
    mx = ML + (CW - mw) / 2

    c.saveState()
    p = c.beginPath()
    p.roundRect(mx, y - mh, mw, mh, 3 * mm)
    c.clipPath(p, stroke=0, fill=0)
    c.drawImage(os.path.join(HERE, "map.png"), mx, y - mh, mw, mh)
    c.restoreState()
    c.setStrokeColor(T.RULE)
    c.setLineWidth(0.6)
    c.roundRect(mx, y - mh, mw, mh, 3 * mm, stroke=1, fill=0)
    y -= mh + 9 * mm

    legend = [(T.DAY1, "Ziua 1"), (T.DAY2, "Ziua 2"), (T.OPT, "Opriri opționale")]
    widths = [8 * mm + pdfmetrics.stringWidth(t, BOLD, 9) for _, t in legend]
    total = sum(widths) + 10 * mm * (len(legend) - 1)
    lx = ML + (CW - total) / 2
    for (col, label), w in zip(legend, widths):
        c.setFillColor(col)
        c.circle(lx + 2.2 * mm, y + 1.0 * mm, 2.2 * mm, stroke=0, fill=1)
        c.setFont(BOLD, 9)
        c.setFillColor(T.INK)
        c.drawString(lx + 7 * mm, y - 1.1 * mm, label)
        lx += w + 10 * mm


# --------------------------------------------------------------------- flow

def build():
    register_fonts()
    c = pdfcanvas.Canvas(OUT, pagesize=A4)
    c.setTitle(TITLE)
    c.setAuthor("")
    c.setSubject(INTRO)

    draw_cover(c)
    c.showPage()

    page = 2
    page_background(c)
    y = PH - MT
    bottom = MB + 4 * mm

    def newpage():
        nonlocal y, page
        footer(c, page)
        c.showPage()
        page += 1
        page_background(c)
        y = PH - MT

    def need(h):
        nonlocal y
        if y - h < bottom:
            newpage()

    for title, sub, items, color, soft in (
            (DAY1_TITLE, DAY1_SUB, DAY1, T.DAY1, T.DAY1_SOFT),
            (DAY2_TITLE, DAY2_SUB, DAY2, T.DAY2, T.DAY2_SOFT)):
        need(DAY_HEADER_H + entry_height(items[0]) + ENTRY_SPACING)
        y -= draw_day_header(c, y, title, sub, color)
        y -= 3 * mm
        for item in items:
            need(entry_height(item) + ENTRY_SPACING)
            y -= draw_entry(c, y, item, color, soft) + ENTRY_SPACING
        y -= 4 * mm

    need(DAY_HEADER_H + opt_height(OPTIONAL[0]) + OPT_SPACING)
    y -= draw_day_header(c, y, OPT_TITLE, OPT_SUB, T.OPT)
    y -= 2 * mm
    for item in OPTIONAL:
        need(opt_height(item) + OPT_SPACING)
        y -= draw_opt(c, y, item) + OPT_SPACING

    # end note, pinned to the bottom of the final page
    note_h = 16 * mm
    if y - note_h < bottom:
        newpage()
    ny = bottom + 6 * mm
    c.setStrokeColor(T.RULE)
    c.setLineWidth(0.5)
    c.line(ML, ny + 9 * mm, PW - MR, ny + 9 * mm)
    c.setFont(ITALIC, 10)
    c.setFillColor(T.INK)
    c.drawCentredString(PW / 2, ny + 2.6 * mm, ENDNOTE)

    footer(c, page)
    c.save()
    print(OUT, os.path.getsize(OUT), "bytes,", page, "pages")


if __name__ == "__main__":
    build()
