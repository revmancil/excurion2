# The Nonprofit Accounting Handbook (sellable PDF)

- `Nonprofit-Accounting-Handbook.pdf` — the finished 41-page guide.
- `build_guide.py` — regenerates the PDF (`python3 build_guide.py`, needs `reportlab`).

To brand it, edit the `BRAND` dict at the top of `build_guide.py` (set `publisher` to your
name or website; it appears on the cover and in every page footer), then rebuild.

## Marketing (`marketing/`)

- `sales-copy.md` — titles, description, FAQ, tags, price suggestion, social post.
- `banner-1600x900.png` — wide listing cover (Gumroad/Payhip/website).
- `thumbnail-1200x1200.png` — square thumbnail (Etsy/Gumroad/social).
- `cover.png` — the cover page alone at high resolution.

To regenerate images after changing the PDF:
```
cd marketing
pdftoppm -r 200 -png -f 1 -l 1 -singlefile ../Nonprofit-Accounting-Handbook.pdf cover
for p in 7 18 37; do pdftoppm -r 110 -png -f $p -l $p -singlefile ../Nonprofit-Accounting-Handbook.pdf _p$p; done
python3 make_images.py
```
