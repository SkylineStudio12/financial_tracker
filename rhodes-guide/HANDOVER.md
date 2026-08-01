# Handover — "Weekend în Rhodos" PDF guide

A self-contained generator for a 2-day Rhodes travel guide PDF. It has nothing
to do with the financial tracker; it lives in this repo only because git was the
only durable channel between two ephemeral Claude Code sessions. Delete the
`rhodes-guide/` directory once the PDF is final.

## What the next session has to do

**One job: put real photos in `rhodes-guide/photos/` and rebuild.** Everything
else is finished and verified.

```bash
cd rhodes-guide
pip install -r requirements.txt
# copy the 14 photos into photos/ named <slug>.jpg  (see the table below)
python3 build_pdf.py          # writes rhodes-weekend.pdf
```

`build_pdf.py` picks up `photos/<slug>.{jpg,jpeg,png,webp}` automatically and
falls back to a monogram placeholder tile for any slug with no file, so a
partial set still builds. Nothing else needs editing.

To eyeball the result:

```bash
python3 -c "
import pypdfium2 as pdfium
d = pdfium.PdfDocument('rhodes-weekend.pdf')
[d[i].render(scale=1.6).to_pil().save(f'page{i+1}.png') for i in range(len(d))]"
```

## Photo slugs

Filename drives placement, so name carefully. The owner has the photos and
knows which is which — **do not re-guess the three marked `??`; ask.**

| slug | entry | what the photo should show |
|---|---|---|
| `petaloudes` | Ziua 1 · 1 | Jersey tiger moths massed on leaves |
| `kameiros` | Ziua 1 · 2 | excavated ruins above the sea |
| `kameiros-skala` | Ziua 1 · 3 | small fishing harbour, boats and coaches |
| `embonas` | Ziua 1 · 4 | aerial of the village under the ridge |
| `kritinia` | Ziua 1 · 5 | ruined castle on a hilltop, sea beyond |
| `monolithos` | Ziua 1 · 6 | castle on the white crag, forest and coast |
| `filerimos` | Ziua 2 · 1 | monastery arcade with bougainvillea |
| `lindos` | Ziua 2 · 2 | white village above the bay |
| `kallithea` | Ziua 2 · 3 | aerial of the spa complex and coves |
| `siana` | opțional | `??` village square, or the twin-belfry church |
| `profitis-ilias` | opțional | `??` owner sent a cove with yachts, which does not match "vârf de munte cu pădure de pini" — confirm before using |
| `salakos` | opțional | `??` the other of square / twin-belfry church |
| `fourni` | opțional | empty sandy cove, turquoise water |
| `epta-piges` | opțional | dam waterfall into the green pool |

Optional `photos/credits.json` — `{"<slug>": "Author / License"}` — prints a
5.6pt caption under that photo. Absent slugs get no caption.

## Files

| file | role |
|---|---|
| `data.py` | all itinerary content and coordinates — **single source of truth** |
| `theme.py` | palette + font paths |
| `build_pdf.py` | layout and rendering, direct reportlab canvas |
| `make_map.py` | renders `map.png` via staticmap |
| `coastline.py` | GSHHS shoreline reader (feeds the map base layer) |
| `fetch_images.py` | Wikimedia Commons downloader — blocked here, kept for other networks |
| `map.png` | pre-rendered map; only re-run `make_map.py` if `data.py` coords change |

## Design decisions worth not re-litigating

**Map base layer is vector, not tiles.** Every tile host was 403'd by the egress
proxy (`tile.openstreetmap.org`, carto, stadia, arcgis, opentopomap). staticmap
still does the projection, dashed route lines, and circle markers; `OfflineBaseMap`
in `make_map.py` overrides `_draw_base_layer` to draw the full-resolution GSHHS
shoreline shipped inside `basemap-data-hires` (public domain) instead of
fetching rasters. If the next session has open network and prefers real tiles,
deleting that subclass restores stock staticmap behaviour — but check the result
first, the vector version reads better at this scale.

**Two coordinates were corrected** against the owner's brief; both are flagged
in comments in `data.py` and were reported to and accepted by the owner:
- Lindos: brief said `36.4400, 28.2107`, ~40 km north of Lindos near Koskinou → `36.0917, 28.0875`
- Kritinia Castle: brief said `36.1489, 27.8408`, ~11 km inland → `36.2394, 27.7908`

All twelve other coordinates plot as supplied, including a ~4 km discrepancy on
Profitis Ilias that was judged too small to matter at map scale.

**Romanian text is verbatim from the brief and must stay that way.** No
commentary, no questions, no added prose in the document. The only strings not
from the brief are structural furniture: the cover eyebrow "GHID DE WEEKEND ·
GRECIA", the map legend ("Ziua 1" / "Ziua 2" / "Opriri opționale"), map place
labels, "MAREA EGEE", "10 km", and the running footer. There is a fidelity check
worth re-running after any edit — it asserts every source string survives into
the PDF text layer:

```bash
python3 - <<'PY'
import re, pypdfium2 as pdfium, data as D
doc = pdfium.PdfDocument("rhodes-weekend.pdf")
flat = re.sub(r"\s+", " ", "\n".join(
    doc[i].get_textpage().get_text_range() for i in range(len(doc))))
checks = [D.TITLE, D.INTRO, D.ENDNOTE, D.DAY1_TITLE, D.DAY1_SUB,
          D.DAY2_TITLE, D.DAY2_SUB, D.OPT_TITLE, D.OPT_SUB]
for it in D.DAY1 + D.DAY2 + D.OPTIONAL:
    checks += [it["name"], it["desc"]] + ([it["time"]] if "time" in it else [])
bad = [c for c in checks if re.sub(r"\s+", " ", c).strip() not in flat]
print("missing:", bad or "none")
PY
```

**Fonts must carry Romanian diacritics.** Helvetica/WinAnsi cannot encode
`ș` (U+0219) or `ț` (U+021B). The build embeds YoungSerif (display) and WorkSans
(body/bold/italic) from `/mnt/skills/examples/canvas-design/canvas-fonts/`. If
that path is absent in the next environment, substitute any TTF with Latin
Extended-B coverage and update `theme.py`; DejaVuSans at
`/usr/share/fonts/truetype/dejavu/` is a safe fallback.

**Gotcha already paid for:** reportlab's canvas text state is sticky.
`setCharSpace` inside a text object leaks into every later `drawString` and
silently letter-spaces the whole document. `tracked()` resets it to 0 before
`drawText`. Don't remove that line.

## Current output

4 pages, A4, ~230 KB.

1. Cover — eyebrow, title, intro line, full-width map, colour legend
2. `ZIUA 1 — Sâmbătă` header + entries 1–4
3. entries 5–6, `ZIUA 2 — Duminică` header + entries 1–2
4. entry 3, `Opriri opționale` (lighter, smaller, unnumbered) + the end note
   pinned above the footer

Pagination is automatic from measured block heights; adding real photos does not
change it, since entry height is `max(thumb, text)` and the thumb dominates.
Layout constants are near the top of the "blocks" section in `build_pdf.py`
(`ENTRY_TH_W/H`, `ENTRY_SPACING`, `OPT_*`).

Map: Day 1 terracotta `#C0532A` (numbered 1–6), Day 2 Aegean blue `#1D6E8B`
(numbered 1–3), optional stops unnumbered stone `#8C8377`, plus Rodos /
Faliraki / Halki for orientation and a 10 km scale bar.

## Deliverable

Single file `rhodes-weekend.pdf`. The owner wants it as a file, not as a repo
artefact — hand it over directly and drop `rhodes-guide/` when done.
