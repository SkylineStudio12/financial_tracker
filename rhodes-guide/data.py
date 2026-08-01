# -*- coding: utf-8 -*-
"""Itinerary data for the Rhodes weekend guide. Text is Romanian, verbatim."""

TITLE = "Weekend în Rhodos — Ghid pe 2 zile"
INTRO = ("Coasta vestică, apus la Monolithos, sate de munte și Lindos — "
         "un weekend cu mașina pe insulă.")
ENDNOTE = "Mașina se predă lângă Faliraki duminică la 17:00."

DAY1_TITLE = "ZIUA 1 — Sâmbătă"
DAY1_SUB = "Coasta vestică"
DAY2_TITLE = "ZIUA 2 — Duminică"
DAY2_SUB = "Filerimos, Lindos & retur"
OPT_TITLE = "Opriri opționale"
OPT_SUB = "dacă mai rămâne timp"

DAY1 = [
    dict(n=1, slug="petaloudes", map_label="Valea Fluturilor", name="Valea Fluturilor (Petaloudes)", time="10:00",
         desc="Vale răcoroasă și umbroasă, chiar sezonul fluturilor în august. "
              "Plimbare pe cărări cu apă, ~1h.",
         lat=36.3394, lon=28.0597,
         queries=["Petaloudes Rhodes valley of the butterflies",
                  "Valley of the Butterflies Rhodes",
                  "Petaloudes Rhodos"]),
    dict(n=2, slug="kameiros", map_label="Ancient Kameiros", name="Ancient Kameiros", time="12:15",
         desc="Ruinele bine păstrate ale unuia din cele trei orașe-state antice ale "
              "insulei. Liniștit, mult mai puțin aglomerat ca Lindos.",
         lat=36.3123, lon=27.9223,
         queries=["Ancient Kameiros Rhodes", "Kameiros archaeological site",
                  "Kamiros Rhodes ruins"]),
    dict(n=3, slug="kameiros-skala", map_label="Kameiros Skala", name="Prânz la Althemenis (Kameiros Skala)", time="14:00",
         desc="Port de pescari autentic. Platou de fructe de mare (~32.5€), "
              "caracatiță (15€). Pește proaspăt de zi.",
         lat=36.2718, lon=27.8254,
         queries=["Kameiros Skala harbour Rhodes", "Kamiros Skala port",
                  "Skala Kamirou Rhodes"]),
    dict(n=4, slug="embonas", map_label="Embonas", name="Embonas — degustare de vin (Dionisos)", time="15:30",
         desc="Satul viticol de munte. Degustare de vinuri, uleiuri, miere și mezeluri "
              "locale. Una dintre cele mai bune experiențe autentice de pe insulă.",
         lat=36.2286, lon=27.8594,
         queries=["Embonas Rhodes village", "Embonas vineyard Rhodes",
                  "Emponas Rhodes"]),
    # Coordinate corrected: the brief's 36.1489/27.8408 is ~11 km inland from the
    # castle, which sits on the west coast road between Skala and Siana.
    dict(n=5, slug="kritinia", map_label="Kritinia", name="Kritinia Castle", time="17:00",
         desc="Castel venețian cu priveliște spre mare și insulele mici. Oprire scurtă.",
         lat=36.2394, lon=27.7908,
         queries=["Kritinia Castle Rhodes", "Kastellos Kritinia",
                  "Kritinia castle"]),
    dict(n=6, slug="monolithos", map_label="Monolithos", name="Monolithos Castle (APUS)", time="19:30",
         desc="Castel venețian pe stâncă, cu fața la Marea Egee și insula Halki. "
              "Urcare ~15 min, apus în jur de 20:15. Punctul culminant al zilei. "
              "Cină după în satul Monolithos.",
         lat=36.1246, lon=27.7260,
         queries=["Monolithos Castle Rhodes", "Monolithos Rhodes castle sunset",
                  "Castle of Monolithos"]),
]

DAY2 = [
    dict(n=1, slug="filerimos", map_label="Filerimos", name="Filerimos Monastery", time="9:30",
         desc="Mănăstire pe vârf de deal, alee de pini spre cruce, priveliște superbă, "
              "mulți păuni. Răcoare dimineața.",
         lat=36.3989, lon=28.1445,
         queries=["Filerimos monastery Rhodes", "Filerimos Rhodes",
                  "Ialysos Filerimos church"]),
    # Coordinate corrected: the brief's 36.4400/28.2107 is ~40 km north of Lindos,
    # on the coast near Koskinou.
    dict(n=2, slug="lindos", map_label="Lindos", name="Lindos (cu Feraklos Castle pe drum)", time="12:00",
         desc="Acropola antică + satul pietonal alb. Prânz cu vedere la golf.",
         lat=36.0917, lon=28.0875,
         queries=["Lindos Rhodes acropolis", "Lindos village Rhodes",
                  "Acropolis of Lindos"]),
    dict(n=3, slug="kallithea", map_label="Kallithea", name="Kallithea Springs", time="15:30",
         desc="Complex termal restaurat din epoca italiană, grădini frumoase, golf cu "
              "apă cristalină. Intrare 5€. Sanctuar de pisici la intrare.",
         lat=36.3776, lon=28.2373,
         queries=["Kallithea Springs Rhodes", "Kallithea thermal baths Rhodes",
                  "Kalithea Rhodes"]),
]

OPTIONAL = [
    dict(slug="siana", map_label="Siana", name="Siana",
         desc="sat de munte tradițional, faimos pentru miere și souma (rachiu local). "
              "Pe drumul spre Monolithos.",
         lat=36.1538, lon=27.7781,
         queries=["Siana Rhodes village", "Siana Rhodos"]),
    dict(slug="profitis-ilias", map_label="Profitis Ilias", name="Profitis Ilias",
         desc="vârf de munte cu pădure de pini și o vilă din epoca ocupației italiene. "
              "Liniște și priveliști spectaculoase.",
         lat=36.2731, lon=27.9461,
         queries=["Profitis Ilias Rhodes", "Elafos Elafina Rhodes hotel"]),
    dict(slug="salakos", map_label="Salakos", name="Salakos",
         desc="sat autentic liniștit la poalele muntelui, cafenele tradiționale.",
         lat=36.2899, lon=27.9435,
         queries=["Salakos Rhodes village", "Salakos Rhodos"]),
    dict(slug="fourni", map_label="Fourni Beach", name="Fourni Beach",
         desc="plajă retrasă chiar sub Monolithos, apus frumos, puțini oameni. "
              "Drum îngust și abrupt.",
         lat=36.1060, lon=27.7371,
         queries=["Fourni beach Rhodes", "Fourni Rhodos beach"]),
    dict(slug="epta-piges", map_label="Seven Springs", name="Seven Springs (Epta Piges)",
         desc="răcoare, umbră și un tunel prin care treci prin apă. Aproape de Faliraki.",
         lat=36.2532, lon=28.1135,
         queries=["Seven Springs Rhodes", "Epta Piges Rhodes"]),
]

ALL_POINTS = DAY1 + DAY2 + OPTIONAL
