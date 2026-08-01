# -*- coding: utf-8 -*-
"""Shared palette + font paths."""
import os

FONT_DIR = "/mnt/skills/examples/canvas-design/canvas-fonts"
F_DISPLAY = os.path.join(FONT_DIR, "YoungSerif-Regular.ttf")
F_BODY = os.path.join(FONT_DIR, "WorkSans-Regular.ttf")
F_BODY_B = os.path.join(FONT_DIR, "WorkSans-Bold.ttf")
F_BODY_I = os.path.join(FONT_DIR, "WorkSans-Italic.ttf")
F_BODY_BI = os.path.join(FONT_DIR, "WorkSans-BoldItalic.ttf")

INK = "#22201D"
MUTED = "#6E675E"
FAINT = "#A79E92"
RULE = "#DDD5C7"
PAPER = "#FBF7F0"
CARD = "#FFFFFF"

DAY1 = "#C0532A"       # terracotta
DAY1_SOFT = "#F3E2D6"
DAY2 = "#1D6E8B"       # aegean blue
DAY2_SOFT = "#DCE9EF"
OPT = "#8C8377"        # stone
OPT_SOFT = "#EAE4DA"

SEA = "#D9E8EF"
SEA_DEEP = "#BFD6E1"
LAND = "#F4EDDF"
COAST = "#A8BFCB"


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
