# -*- coding: utf-8 -*-
"""Render the island map with `staticmap`.

Tile servers are blocked by this environment's egress policy, so the base layer
is drawn from the offline GSHHS shoreline instead of raster tiles; everything
else (projection, lines, circle markers, compositing) is staticmap's.
"""
import math
import os

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from staticmap import StaticMap, CircleMarker, Line
from staticmap.staticmap import _lon_to_x, _lat_to_y

import theme as T
from coastline import land_polygons
from data import DAY1, DAY2, OPTIONAL

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "map.png")

# map window (lon/lat) and tile zoom
W, S, E, N = 27.46, 35.855, 28.40, 36.55
ZOOM = 11
SS = 2  # supersample factor for the hand-drawn base layer

# label anchor per slug: (dx, dy, halign) in final pixels
LABELS = {
    "petaloudes":     (16, 0, "l"),
    "kameiros":       (-16, -2, "r"),
    "kameiros-skala": (-16, 0, "r"),
    "embonas":        (16, 2, "l"),
    "kritinia":       (-16, 9, "r"),
    "monolithos":     (-16, -7, "r"),
    "filerimos":      (-16, -4, "r"),
    "lindos":         (16, 4, "l"),
    "kallithea":      (16, 0, "l"),
    "siana":          (14, 4, "l"),
    "profitis-ilias": (13, 10, "l"),
    "salakos":        (13, -10, "l"),
    "fourni":         (-13, 11, "r"),
    "epta-piges":     (13, 0, "l"),
}

# unvisited places kept for orientation only
CONTEXT = [
    ("Rodos", 28.2258, 36.4436, 13, -2, "l"),
    ("Faliraki", 28.2029, 36.3403, 13, 2, "l"),
    ("Halki", 27.5710, 36.1900, 0, 0, "c"),
]


class OfflineBaseMap(StaticMap):
    """StaticMap whose base layer is vector shoreline instead of raster tiles."""

    def __init__(self, *args, **kwargs):
        self.land = kwargs.pop("land", [])
        super().__init__(*args, **kwargs)

    def _px(self, lon, lat, scale=1):
        return (self._x_to_px(_lon_to_x(lon, self.zoom)) * scale,
                self._y_to_px(_lat_to_y(lat, self.zoom)) * scale)

    def _draw_base_layer(self, image):
        w, h = self.width * SS, self.height * SS

        # soft drop shadow under the coastline, so land lifts off the water
        shadow = Image.new("L", (w, h), 0)
        sd = ImageDraw.Draw(shadow)
        for poly in self.land:
            pts = [self._px(lon, lat, SS) for lon, lat in poly]
            if len(pts) >= 3:
                sd.polygon([(x + 7, y + 9) for x, y in pts], fill=90)
        shadow = shadow.filter(ImageFilter.GaussianBlur(9))

        base = Image.new("RGB", (w, h), T.rgb(T.SEA))
        base.paste(Image.new("RGB", (w, h), T.rgb(T.SEA_DEEP)), (0, 0), shadow)

        d = ImageDraw.Draw(base)
        for poly in self.land:
            pts = [self._px(lon, lat, SS) for lon, lat in poly]
            if len(pts) >= 3:
                d.polygon(pts, fill=T.rgb(T.LAND), outline=T.rgb(T.COAST), width=2 * SS)

        image.paste(base.resize((self.width, self.height), Image.LANCZOS), (0, 0))


def dashes(p1, p2, on=13.0, off=9.0):
    """Split a lon/lat segment into dashed sub-segments (approx. equal pixel steps)."""
    (x1, y1), (x2, y2) = p1, p2
    dist = math.hypot(x2 - x1, y2 - y1)
    if dist == 0:
        return []
    # work in degrees, convert the dash length using a rough deg->px factor
    per_deg = 256 * 2 ** ZOOM / 360.0
    total_px = dist * per_deg
    step = (on + off) / total_px if total_px else 1
    frac_on = on / total_px if total_px else 1
    out, t = [], 0.0
    while t < 1.0:
        a = t
        b = min(1.0, t + frac_on)
        out.append([(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a),
                    (x1 + (x2 - x1) * b, y1 + (y2 - y1) * b)])
        t += step
    return out


def route(m, pts, color, width=3):
    for a, b in zip(pts, pts[1:]):
        for seg in dashes((a["lon"], a["lat"]), (b["lon"], b["lat"])):
            m.add_line(Line(seg, color, width, simplify=False))


def marker(m, p, color, r=13, ring=4):
    m.add_marker(CircleMarker((p["lon"], p["lat"]), "#FFFFFF", 2 * (r + ring)))
    m.add_marker(CircleMarker((p["lon"], p["lat"]), color, 2 * r))


def build():
    per_deg = 256 * 2 ** ZOOM / 360.0
    width = int(round((E - W) * per_deg))
    height = int(round((_lat_to_y(S, ZOOM) - _lat_to_y(N, ZOOM)) * 256))

    m = OfflineBaseMap(width, height, land=land_polygons(W, S, E, N),
                       background_color=T.SEA)

    route(m, DAY1, T.rgb(T.DAY1) + (170,), 3)
    route(m, DAY2, T.rgb(T.DAY2) + (170,), 3)

    for p in OPTIONAL:
        m.add_marker(CircleMarker((p["lon"], p["lat"]), "#FFFFFF", 2 * 11))
        m.add_marker(CircleMarker((p["lon"], p["lat"]), T.OPT, 2 * 7))
    for p in DAY1:
        marker(m, p, T.DAY1)
    for p in DAY2:
        marker(m, p, T.DAY2)

    img = m.render(zoom=ZOOM, center=((W + E) / 2, (S + N) / 2)).convert("RGB")
    draw = ImageDraw.Draw(img)

    f_num = ImageFont.truetype(T.F_BODY_B, 19)
    f_lab = ImageFont.truetype(T.F_BODY_B, 17)
    f_opt = ImageFont.truetype(T.F_BODY_I, 15)
    f_sea = ImageFont.truetype(T.F_BODY_I, 19)

    def px(p):
        return m._px(p["lon"], p["lat"])

    def halo_text(xy, text, font, fill, anchor):
        x, y = xy
        for ox in (-2, -1, 0, 1, 2):
            for oy in (-2, -1, 0, 1, 2):
                if ox or oy:
                    draw.text((x + ox, y + oy), text, font=font,
                              fill=(255, 255, 255), anchor=anchor)
        draw.text((x, y), text, font=font, fill=fill, anchor=anchor)

    # sea caption + places that are only there for orientation
    halo_text((int(0.13 * width), int(0.085 * height)), "MAREA EGEE", f_sea,
              T.rgb(T.COAST), "mm")
    for name, lon, lat, dx, dy, ha in CONTEXT:
        x, y = m._px(lon, lat)
        if ha != "c":
            draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=T.rgb(T.FAINT))
        halo_text((x + dx, y + dy), name, f_opt, T.rgb(T.FAINT),
                  {"l": "lm", "r": "rm", "c": "mm"}[ha])

    for p in OPTIONAL:
        x, y = px(p)
        dx, dy, ha = LABELS[p["slug"]]
        halo_text((x + dx, y + dy), p["map_label"], f_opt,
                  T.rgb(T.OPT), ("lm" if ha == "l" else "rm"))

    for group, color in ((DAY1, T.DAY1), (DAY2, T.DAY2)):
        for p in group:
            x, y = px(p)
            draw.text((x, y + 1), str(p["n"]), font=f_num,
                      fill=(255, 255, 255), anchor="mm")
            dx, dy, ha = LABELS[p["slug"]]
            halo_text((x + dx, y + dy), p["map_label"],
                      f_lab, T.rgb(color), ("lm" if ha == "l" else "rm"))

    # scale bar: 10 km
    km_px = 10_000 / (111_320 * math.cos(math.radians((S + N) / 2))) * (256 * 2 ** ZOOM / 360.0)
    bx, by = 34, height - 40
    draw.line([(bx, by), (bx + km_px, by)], fill=T.rgb(T.MUTED), width=3)
    for tick in (bx, bx + km_px):
        draw.line([(tick, by - 6), (tick, by + 6)], fill=T.rgb(T.MUTED), width=3)
    halo_text((bx + km_px / 2, by - 17), "10 km",
              ImageFont.truetype(T.F_BODY, 15), T.rgb(T.MUTED), "mm")

    img.save(OUT, "PNG")
    print(f"{OUT}  {img.size[0]}x{img.size[1]}")


if __name__ == "__main__":
    build()
