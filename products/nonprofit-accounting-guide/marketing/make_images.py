"""Make store listing images from the rendered PDF pages.

Run from this folder after rendering cover.png and _p*.png (see README).
Outputs: banner-1600x900.png (wide listing cover) and thumbnail-1200x1200.png (square).
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter

NAVY = (31, 58, 95)
NAVY_LINE = (44, 76, 117)
TEAL = (42, 157, 143)
GOLD = (233, 162, 59)
LIGHT = (220, 231, 243)
F = "/usr/share/fonts/truetype/crosextra/"
head = lambda s: ImageFont.truetype(F + "Caladea-Bold.ttf", s)
body = lambda s: ImageFont.truetype(F + "Carlito-Regular.ttf", s)
bold = lambda s: ImageFont.truetype(F + "Carlito-Bold.ttf", s)

cover = Image.open("cover.png").convert("RGB")
_b = ImageDraw.Draw(cover)
_b.rectangle([0, 0, cover.width - 1, cover.height - 1], outline=(120, 150, 190), width=8)
pages = [Image.open("_p%d.png" % n).convert("RGB") for n in (7, 18, 37)]


def background(w, h):
    im = Image.new("RGB", (w, h), NAVY)
    d = ImageDraw.Draw(im)
    for y in range(30, h, 34):
        d.line([(0, y), (w, y)], fill=NAVY_LINE, width=1)
    return im


def paste_page(canvas, page, height, x, y, angle=0):
    p = page.resize((int(page.width * height / page.height), height), Image.LANCZOS).convert("RGBA")
    if angle:
        p = p.rotate(angle, expand=True, resample=Image.BICUBIC)
    shadow = Image.new("RGBA", (p.width + 60, p.height + 60), (0, 0, 0, 0))
    mask = p.split()[3].point(lambda a: int(a * 0.55))
    shadow.paste((0, 0, 0, 255), (30, 30), mask)
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    canvas.alpha_composite(shadow, (x - 22, y - 14))
    canvas.alpha_composite(p, (x, y))


def bullets(d, items, x, y, size, gap):
    for it in items:
        d.ellipse([x, y + size * 0.42, x + size * 0.38, y + size * 0.8], fill=GOLD)
        d.text((x + size * 0.85, y), it, font=body(size), fill=LIGHT)
        y += gap
    return y


# ---- wide banner 1600x900 ----
W, H = 1600, 900
im = background(W, H).convert("RGBA")
d = ImageDraw.Draw(im)
d.text((90, 110), "41-PAGE PDF GUIDE  •  2026 EDITION", font=bold(26), fill=(168, 198, 229))
d.text((90, 160), "The Nonprofit", font=head(78), fill="white")
d.text((90, 248), "Accounting Handbook", font=head(78), fill="white")
d.rectangle([90, 362, 210, 369], fill=GOLD)
d.text((90, 395), "Plain-English bookkeeping, financial statements,", font=body(32), fill=LIGHT)
d.text((90, 437), "and IRS compliance for U.S. nonprofits", font=body(32), fill=LIGHT)
bullets(d, ["Donor restrictions made simple",
            "Chart of accounts + journal entries",
            "Form 990, gift receipts & grants",
            "Checklists, templates & glossary"], 92, 520, 30, 50)
d.rectangle([90, 760, 520, 822], fill=TEAL)
d.text((120, 772), "Instant download  •  Printable", font=bold(30), fill="white")
paste_page(im, pages[0], 560, 1060, 190, angle=-7)
paste_page(im, pages[1], 580, 1150, 150, angle=5)
paste_page(im, cover, 620, 910, 140)
im.convert("RGB").save("banner-1600x900.png", optimize=True)

# ---- square thumbnail 1200x1200 ----
S = 1200
im = background(S, S).convert("RGBA")
d = ImageDraw.Draw(im)
paste_page(im, pages[2], 760, 560, 250, angle=8)
paste_page(im, pages[0], 760, 470, 225, angle=3)
paste_page(im, cover, 820, 150, 190)
d.rectangle([0, 0, S, 120], fill=TEAL)
txt = "Nonprofit Accounting, Made Simple"
tw = d.textlength(txt, font=head(56))
d.text(((S - tw) / 2, 28), txt, font=head(56), fill="white")
d.rectangle([0, 1110, S, S], fill=(22, 42, 70))
txt = "41 pages  •  Templates  •  Checklists  •  Glossary"
tw = d.textlength(txt, font=bold(38))
d.text(((S - tw) / 2, 1130), txt, font=bold(38), fill=LIGHT)
im.convert("RGB").save("thumbnail-1200x1200.png", optimize=True)
print("done")
