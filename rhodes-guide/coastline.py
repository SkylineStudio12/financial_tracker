# -*- coding: utf-8 -*-
"""Rhodes-area coastline polygons, read from the GSHHS full-resolution shoreline
data shipped with the `basemap-data-hires` package (public domain, NOAA/NGDC).

Used as the map base layer because tile servers are unreachable from this
environment.
"""
import os
import struct

_BASE = "/usr/local/lib/python3.11/dist-packages/mpl_toolkits/basemap_data"
_META = os.path.join(_BASE, "gshhsmeta_f.dat")
_DATA = os.path.join(_BASE, "gshhs_f.dat")


def _clip_edge(poly, inside, intersect):
    out = []
    if not poly:
        return out
    prev = poly[-1]
    prev_in = inside(prev)
    for cur in poly:
        cur_in = inside(cur)
        if cur_in:
            if not prev_in:
                out.append(intersect(prev, cur))
            out.append(cur)
        elif prev_in:
            out.append(intersect(prev, cur))
        prev, prev_in = cur, cur_in
    return out


def clip(poly, w, s, e, n):
    """Sutherland-Hodgman clip of a lon/lat polygon against a bbox."""
    def ix(p, q, x):
        t = (x - p[0]) / (q[0] - p[0])
        return (x, p[1] + t * (q[1] - p[1]))

    def iy(p, q, y):
        t = (y - p[1]) / (q[1] - p[1])
        return (p[0] + t * (q[0] - p[0]), y)

    poly = _clip_edge(poly, lambda p: p[0] >= w, lambda p, q: ix(p, q, w))
    poly = _clip_edge(poly, lambda p: p[0] <= e, lambda p, q: ix(p, q, e))
    poly = _clip_edge(poly, lambda p: p[1] >= s, lambda p, q: iy(p, q, s))
    poly = _clip_edge(poly, lambda p: p[1] <= n, lambda p, q: iy(p, q, n))
    return poly


def land_polygons(w, s, e, n, min_area=0.05):
    """Return land polygons (lists of lon/lat pairs) clipped to the bbox."""
    polys = []
    with open(_META) as meta, open(_DATA, "rb") as dat:
        for line in meta:
            f = line.split()
            typ, area, npts = int(f[0]), float(f[1]), int(f[2])
            south, north = float(f[3]), float(f[4])
            off, cnt = int(f[5]), int(f[6])
            if typ != 1 or area < min_area:
                continue
            if north < s or south > n:
                continue
            dat.seek(off, 0)
            raw = dat.read(cnt)
            pts = struct.unpack("<%df" % (npts * 2), raw)
            coords = list(zip(pts[0::2], pts[1::2]))
            lons = pts[0::2]
            if max(lons) < w or min(lons) > e:
                continue
            c = clip(coords, w, s, e, n)
            if len(c) >= 3:
                polys.append(c)
    polys.sort(key=len, reverse=True)
    return polys


if __name__ == "__main__":
    ps = land_polygons(27.46, 35.83, 28.40, 36.55)
    print(len(ps), "polygons")
    for p in ps[:6]:
        lo = [c[0] for c in p]
        la = [c[1] for c in p]
        print(len(p), round(min(lo), 3), round(min(la), 3), round(max(lo), 3), round(max(la), 3))
