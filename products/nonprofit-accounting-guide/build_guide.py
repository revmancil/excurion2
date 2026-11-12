"""Build "The Nonprofit Accounting Handbook" PDF.

Run: python3 build_guide.py  ->  writes Nonprofit-Accounting-Handbook.pdf next to this file.
Edit BRAND below to put your own name/site on the cover and footer.
"""
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
                                PageBreak, Table, TableStyle, KeepTogether, NextPageTemplate,
                                CondPageBreak)
from reportlab.platypus.tableofcontents import TableOfContents

BRAND = {
    "title": "The Nonprofit Accounting Handbook",
    "subtitle": "A Plain-English Guide to Bookkeeping, Financial Statements, and Compliance for U.S. Nonprofits",
    "edition": "2026 Edition",
    "publisher": "",          # e.g. "Your Name / yoursite.com"
    "year": "2026",
}

# The author's own businesses, promoted inside the guide.
ML_URL = "https://missionledger.fund"
FB_URL = "https://frontlinebookkeeping.com"
ML = '<a href="%s" color="#1F3A5F"><b>MissionLedger</b></a>' % ML_URL
FB = '<a href="%s" color="#1F3A5F"><b>Frontline Bookkeeping</b></a>' % FB_URL
ML_LINK = '<a href="%s" color="#2A9D8F"><u>missionledger.fund</u></a>' % ML_URL
FB_LINK = '<a href="%s" color="#2A9D8F"><u>frontlinebookkeeping.com</u></a>' % FB_URL

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "Nonprofit-Accounting-Handbook.pdf")

# ---------- fonts ----------
FD = "/usr/share/fonts/truetype"
def _find(name):
    for root, _, files in os.walk(FD):
        if name in files:
            return os.path.join(root, name)
    raise FileNotFoundError(name)

pdfmetrics.registerFont(TTFont("Body", _find("Carlito-Regular.ttf")))
pdfmetrics.registerFont(TTFont("Body-Bold", _find("Carlito-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Body-Italic", _find("Carlito-Italic.ttf")))
pdfmetrics.registerFont(TTFont("Body-BoldItalic", _find("Carlito-BoldItalic.ttf")))
pdfmetrics.registerFont(TTFont("Head", _find("Caladea-Bold.ttf")))
pdfmetrics.registerFont(TTFont("Head-Reg", _find("Caladea-Regular.ttf")))
pdfmetrics.registerFont(TTFont("Sym", _find("DejaVuSans.ttf")))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Body-Bold",
                              italic="Body-Italic", boldItalic="Body-BoldItalic")

# ---------- palette ----------
NAVY = colors.HexColor("#1F3A5F")
TEAL = colors.HexColor("#2A9D8F")
TEAL_LT = colors.HexColor("#E6F4F2")
GOLD = colors.HexColor("#E9A23B")
GOLD_LT = colors.HexColor("#FDF3E3")
RED_LT = colors.HexColor("#FBEAEA")
RED = colors.HexColor("#B5483B")
GRAY = colors.HexColor("#5B6573")
GRID = colors.HexColor("#D5DBE3")
ROW = colors.HexColor("#F4F6F9")
INK = colors.HexColor("#1E2329")

# ---------- styles ----------
S = {}
S["body"] = ParagraphStyle("body", fontName="Body", fontSize=11, leading=15.5, textColor=INK,
                           spaceAfter=7)
S["small"] = ParagraphStyle("small", parent=S["body"], fontSize=9.5, leading=12.5, spaceAfter=0)
S["cell"] = ParagraphStyle("cell", parent=S["body"], fontSize=9.5, leading=12, spaceAfter=0)
S["cellb"] = ParagraphStyle("cellb", parent=S["cell"], fontName="Body-Bold")
S["cellh"] = ParagraphStyle("cellh", parent=S["cell"], fontName="Body-Bold", textColor=colors.white)
S["cellr"] = ParagraphStyle("cellr", parent=S["cell"], alignment=2)
S["cellrb"] = ParagraphStyle("cellrb", parent=S["cellr"], fontName="Body-Bold")
S["bullet"] = ParagraphStyle("bullet", parent=S["body"], leftIndent=16, bulletIndent=4,
                             spaceAfter=3)
S["check"] = ParagraphStyle("check", parent=S["bullet"], bulletFontName="Sym", bulletFontSize=10.5)
S["h1"] = ParagraphStyle("h1", fontName="Head", fontSize=26, leading=31, textColor=NAVY,
                         spaceAfter=6)
S["kicker"] = ParagraphStyle("kicker", fontName="Body-Bold", fontSize=10.5, leading=13,
                             textColor=TEAL, spaceAfter=2)
S["lede"] = ParagraphStyle("lede", parent=S["body"], fontName="Body-Italic", fontSize=12.5,
                           leading=17, textColor=GRAY, spaceAfter=14)
S["h2"] = ParagraphStyle("h2", fontName="Head", fontSize=16, leading=20, textColor=NAVY,
                         spaceBefore=12, spaceAfter=6)
S["h3"] = ParagraphStyle("h3", fontName="Body-Bold", fontSize=12, leading=15, textColor=TEAL,
                         spaceBefore=8, spaceAfter=3)
S["boxtitle"] = ParagraphStyle("boxtitle", fontName="Body-Bold", fontSize=10.5, leading=13,
                               spaceAfter=3)
S["boxbody"] = ParagraphStyle("boxbody", parent=S["body"], fontSize=10.5, leading=14, spaceAfter=3)
S["toc1"] = ParagraphStyle("toc1", fontName="Body", fontSize=11.5, leading=16, leftIndent=0,
                           textColor=INK)
S["toc0"] = ParagraphStyle("toc0", fontName="Body-Bold", fontSize=12, leading=20, textColor=NAVY)


# ---------- doc template ----------
class GuideDoc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(path, pagesize=letter, leftMargin=0.9 * inch, rightMargin=0.9 * inch,
                         topMargin=0.9 * inch, bottomMargin=0.85 * inch,
                         title=BRAND["title"], author=BRAND["publisher"] or BRAND["title"],
                         subject="Nonprofit accounting guide", creator=BRAND["title"])
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="f")
        self.addPageTemplates([
            PageTemplate(id="cover", frames=[frame], onPage=draw_cover),
            PageTemplate(id="plain", frames=[frame], onPage=draw_plain),
            PageTemplate(id="body", frames=[frame], onPageEnd=draw_body),
        ])
        self.chapter = ""

    def afterFlowable(self, f):
        if isinstance(f, Paragraph):
            name = f.style.name
            if name == "h1":
                txt = f.getPlainText()
                self.chapter = getattr(f, "_short", txt)
                key = "ch%d" % id(f)
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(txt, key, level=0)
                self.notify("TOCEntry", (0, txt, self.page, key))
            elif name == "h2":
                key = "s%d" % id(f)
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(f.getPlainText(), key, level=1, closed=True)


def draw_cover(c, doc):
    W, H = letter
    c.saveState()
    c.setFillColor(NAVY)
    c.rect(0, 0, W, H, stroke=0, fill=1)
    # decorative ledger lines
    c.setStrokeColor(colors.HexColor("#2C4C75"))
    c.setLineWidth(0.6)
    for y in range(40, int(H), 22):
        c.line(0, y, W, y)
    c.setStrokeColor(colors.HexColor("#3B6091"))
    c.line(1.15 * inch, 0, 1.15 * inch, H)
    # accent block
    c.setFillColor(TEAL)
    c.rect(0, H - 3.1 * inch, W, 0.12 * inch, stroke=0, fill=1)
    c.setFillColor(GOLD)
    c.rect(1.4 * inch, 4.95 * inch, 1.1 * inch, 0.07 * inch, stroke=0, fill=1)
    # text
    c.setFillColor(colors.HexColor("#A8C6E5"))
    c.setFont("Body-Bold", 12)
    c.drawString(1.4 * inch, H - 2.6 * inch, BRAND["edition"].upper())
    c.setFillColor(colors.white)
    c.setFont("Head", 46)
    c.drawString(1.4 * inch, H - 4.0 * inch, "The Nonprofit")
    c.drawString(1.4 * inch, H - 4.7 * inch, "Accounting")
    c.drawString(1.4 * inch, H - 5.4 * inch, "Handbook")
    sub = Paragraph(BRAND["subtitle"], ParagraphStyle(
        "cs", fontName="Body", fontSize=15, leading=20, textColor=colors.HexColor("#DCE7F3")))
    w, h = sub.wrap(W - 2.8 * inch, 2 * inch)
    sub.drawOn(c, 1.4 * inch, 4.65 * inch - h)
    # feature list
    c.setFont("Body", 11.5)
    c.setFillColor(colors.HexColor("#DCE7F3"))
    feats = ["Net assets & donor restrictions, explained simply",
             "Ready-to-use chart of accounts and journal entries",
             "Form 990, gift receipts, and grant compliance",
             "Month-end checklist, templates, and glossary"]
    y = 3.35 * inch
    for f in feats:
        c.setFillColor(GOLD)
        c.circle(1.47 * inch, y + 3.5, 2.6, stroke=0, fill=1)
        c.setFillColor(colors.HexColor("#DCE7F3"))
        c.drawString(1.62 * inch, y, f)
        y -= 0.3 * inch
    if BRAND["publisher"]:
        c.setFont("Body-Bold", 11)
        c.setFillColor(colors.white)
        c.drawString(1.4 * inch, 1.15 * inch, BRAND["publisher"])
    # sponsor strip
    c.setFillColor(colors.HexColor("#162A46"))
    c.rect(0, 0, W, 0.85 * inch, stroke=0, fill=1)
    c.setFont("Body", 10.5)
    c.setFillColor(colors.HexColor("#A8C6E5"))
    c.drawString(1.4 * inch, 0.5 * inch, "Brought to you by")
    c.setFont("Body-Bold", 12)
    c.setFillColor(colors.white)
    x = 1.4 * inch + c.stringWidth("Brought to you by ", "Body", 10.5)
    sponsor = "Frontline Bookkeeping Solutions"
    c.drawString(x, 0.5 * inch, sponsor)
    w1 = c.stringWidth(sponsor, "Body-Bold", 12)
    c.linkURL(FB_URL, (x, 0.45 * inch, x + w1, 0.7 * inch), relative=0)
    c.restoreState()


def draw_plain(c, doc):
    pass


def draw_body(c, doc):
    W, H = letter
    c.saveState()
    c.setStrokeColor(GRID)
    c.setLineWidth(0.6)
    c.line(doc.leftMargin, H - 0.6 * inch, W - doc.rightMargin, H - 0.6 * inch)
    c.setFont("Body", 8.5)
    c.setFillColor(GRAY)
    c.drawString(doc.leftMargin, H - 0.52 * inch, BRAND["title"])
    c.drawRightString(W - doc.rightMargin, H - 0.52 * inch, doc.chapter)
    c.line(doc.leftMargin, 0.6 * inch, W - doc.rightMargin, 0.6 * inch)
    foot = "© %s %s. For educational purposes only; not legal or tax advice." % (
        BRAND["year"], BRAND["publisher"] or BRAND["title"])
    c.drawString(doc.leftMargin, 0.42 * inch, foot)
    c.setFont("Body-Bold", 9)
    c.setFillColor(NAVY)
    c.drawRightString(W - doc.rightMargin, 0.42 * inch, str(doc.page))
    c.restoreState()


# ---------- helpers ----------
story = []
P = lambda t, s="body": story.append(Paragraph(t, S[s]))
H2 = lambda t: story.append(Paragraph(t, S["h2"]))
H3 = lambda t: story.append(Paragraph(t, S["h3"]))
SP = lambda h=6: story.append(Spacer(1, h))


def bullets(items, style="bullet"):
    for it in items:
        story.append(Paragraph(it, S[style], bulletText="•"))
    SP(4)


def numbered(items):
    for i, it in enumerate(items, 1):
        story.append(Paragraph(it, S["bullet"], bulletText="%d." % i))
    SP(4)


def checklist(items):
    for it in items:
        story.append(Paragraph(it, S["check"], bulletText="☐"))
    SP(4)


def box(title, body, kind="tip"):
    bg, edge = {"tip": (TEAL_LT, TEAL), "warn": (RED_LT, RED), "note": (GOLD_LT, GOLD),
                "brand": (colors.HexColor("#EAF0F7"), NAVY)}[kind]
    tstyle = ParagraphStyle("bt", parent=S["boxtitle"], textColor=edge)
    content = [Paragraph(title, tstyle)]
    if isinstance(body, str):
        body = [body]
    for b in body:
        content.append(Paragraph(b, S["boxbody"]))
    t = Table([[content]], colWidths=[doc.width])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), bg),
        ("LINEBEFORE", (0, 0), (0, -1), 3.5, edge),
        ("LEFTPADDING", (0, 0), (-1, -1), 12), ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ]))
    story.append(Spacer(1, 4))
    story.append(t)
    story.append(Spacer(1, 10))


def table(rows, widths, header=True, num_cols=(), bold_rows=(), total_rows=(), zebra=True):
    data = []
    for r_i, r in enumerate(rows):
        line = []
        for c_i, v in enumerate(r):
            if isinstance(v, str):
                if header and r_i == 0:
                    st = S["cellh"]
                elif c_i in num_cols:
                    st = S["cellrb"] if (r_i in bold_rows or r_i in total_rows) else S["cellr"]
                else:
                    st = S["cellb"] if (r_i in bold_rows or r_i in total_rows) else S["cell"]
                v = Paragraph(v, st)
            line.append(v)
        data.append(line)
    tw = sum(widths)
    widths = [w * doc.width / tw for w in widths]
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0)
    st = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, GRID),
    ]
    if header:
        st += [("BACKGROUND", (0, 0), (-1, 0), NAVY)]
    if zebra:
        for i in range(1 if header else 0, len(rows)):
            if (i % 2 == 0) and i not in total_rows:
                st.append(("BACKGROUND", (0, i), (-1, i), ROW))
    for i in total_rows:
        st += [("LINEABOVE", (0, i), (-1, i), 1, NAVY), ("BACKGROUND", (0, i), (-1, i), TEAL_LT)]
    t.setStyle(TableStyle(st))
    story.append(t)
    story.append(Spacer(1, 10))


def je(title, lines, memo=None):
    """Journal entry: lines = [(account, debit, credit)]"""
    rows = [["Account", "Debit", "Credit"]]
    for a, d, c in lines:
        rows.append([("&nbsp;&nbsp;&nbsp;&nbsp;" + a) if c and not d else a, d, c])
    block = [Paragraph(title, ParagraphStyle("jt", parent=S["cellb"], textColor=NAVY,
                                             spaceAfter=3))]
    data = []
    for r_i, r in enumerate(rows):
        st = S["cellh"] if r_i == 0 else S["cell"]
        stn = S["cellh"] if r_i == 0 else S["cellr"]
        data.append([Paragraph(r[0], st), Paragraph(r[1], stn), Paragraph(r[2], stn)])
    t = Table(data, colWidths=[doc.width * 0.6, doc.width * 0.2, doc.width * 0.2])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), TEAL),
        ("LINEBELOW", (0, 0), (-1, -1), 0.4, GRID),
        ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    block.append(t)
    if memo:
        block.append(Paragraph("<i>" + memo + "</i>", ParagraphStyle(
            "memo", parent=S["small"], textColor=GRAY, spaceBefore=3)))
    block.append(Spacer(1, 10))
    story.append(KeepTogether(block))


def chapter(num, title, lede, short=None):
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())
    if num:
        story.append(Paragraph(num, S["kicker"]))
    p = Paragraph(title, S["h1"])
    p._short = short or title
    story.append(p)
    rule = Table([[""]], colWidths=[1.0 * inch], rowHeights=[3])
    rule.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), GOLD)]))
    rule.hAlign = "LEFT"
    story.append(rule)
    SP(10)
    if lede:
        P(lede, "lede")


doc = GuideDoc(OUT)

# =====================================================================
# COVER + FRONT MATTER
# =====================================================================
story.append(Spacer(1, 1))
story.append(NextPageTemplate("plain"))
story.append(PageBreak())

SP(200)
P("<b>%s</b>" % BRAND["title"], "body")
P(BRAND["edition"], "small")
SP(14)
P("Copyright © %s %s. All rights reserved. No part of this publication may be reproduced, "
  "distributed, or transmitted in any form without prior written permission of the publisher, "
  "except for the worksheets and templates in the appendices, which the purchaser may copy for "
  "use within their own organization." % (BRAND["year"], BRAND["publisher"] or "the publisher"), "small")
SP(10)
P("<b>Disclaimer.</b> This handbook provides general educational information about accounting "
  "for U.S. tax-exempt organizations. It is not legal, tax, or accounting advice, and it does not "
  "create a professional relationship. Laws, IRS rules, dollar thresholds, and accounting standards "
  "change, and state requirements vary. Figures cited reflect the author's understanding as of "
  "late 2026. Before acting, confirm current requirements with the IRS, your state charity "
  "regulator, and a qualified CPA or attorney.", "small")
SP(10)
P("<b>Disclosure.</b> The author owns MissionLedger (%s) and Frontline Bookkeeping (%s), which "
  "are mentioned in this handbook. The guidance in this book applies whatever software or "
  "bookkeeper you use." % (ML_LINK, FB_LINK), "small")

# TOC
story.append(PageBreak())
P("Contents", "h1")
SP(8)
toc = TableOfContents()
toc.levelStyles = [S["toc0"]]
toc.dotsMinLevel = 0
story.append(toc)

# =====================================================================
chapter("", "How to Use This Handbook", None, "Introduction")
P("If you have ever opened your organization's books and wondered why \"profit\" is called "
  "\"change in net assets,\" why a $50,000 grant can't simply be spent on rent, or what exactly "
  "goes on a Form 990, this handbook is for you.")
P("It is written for the people who actually keep small and mid-sized nonprofits running: "
  "executive directors who wear the finance hat, board treasurers, bookkeepers coming from the "
  "for-profit world, and founders who want to get it right from day one. No accounting degree "
  "required. Where a technical term is unavoidable, it is defined in plain English, and every "
  "term is collected in the glossary at the back.")
H2("What you will be able to do")
bullets([
    "Set up a chart of accounts built for nonprofits, not adapted from a retail template.",
    "Record donations, grants, pledges, in-kind gifts, and event income correctly.",
    "Track donor restrictions so you never accidentally spend restricted money.",
    "Split expenses into program, management &amp; general, and fundraising.",
    "Read and produce the four core nonprofit financial statements.",
    "Build a budget, monitor cash, and present clear reports to your board.",
    "Meet IRS requirements: Form 990, donor acknowledgments, and unrelated business income.",
    "Run a reliable month-end close and prepare for an audit or review.",
])
H2("How the book is organized")
table([
    ["Part", "Chapters", "Focus"],
    ["Foundations", "1–3", "What makes nonprofit accounting different; net assets; chart of accounts"],
    ["Day-to-day", "4–5", "Recording revenue and expenses the right way"],
    ["Reporting", "6–7", "Financial statements, budgets, and cash management"],
    ["Protection", "8–9", "Internal controls and grant compliance"],
    ["Compliance", "10–12", "IRS filings, the monthly close, audits, and the board"],
    ["Toolkit", "Appendices", "Templates, checklists, cheat sheet, and glossary"],
], [1.3, 1, 4])
box("Scope note",
    "This handbook follows U.S. generally accepted accounting principles (GAAP) for not-for-profit "
    "entities, found in FASB Accounting Standards Codification Topic 958, and federal IRS rules for "
    "501(c)(3) public charities. Private foundations, churches, government entities, and "
    "organizations outside the U.S. have additional or different rules.", "note")

# =====================================================================
chapter("CHAPTER 1", "Why Nonprofit Accounting Is Different",
        "A business keeps score with profit. A nonprofit keeps score with mission—and its "
        "books must prove that every dollar went where donors and the public were told it would.",
        "1 · Why It's Different")
H2("Stewardship, not ownership")
P("A for-profit company is owned by shareholders, and its accounting answers one central "
  "question: <i>how much did the owners earn?</i> A nonprofit has no owners. Its resources are "
  "held in trust for a public purpose, and its accounting answers different questions:")
bullets([
    "<b>Did we use resources the way donors and grantors required?</b>",
    "<b>How much of our spending went to programs versus overhead and fundraising?</b>",
    "<b>Do we have enough liquid, unrestricted resources to keep operating?</b>",
])
P("Because of this, nonprofit financial statements use different vocabulary and include "
  "information a business never reports.")
H2("The vocabulary shift")
table([
    ["Business term", "Nonprofit equivalent", "Why it matters"],
    ["Balance sheet", "Statement of Financial Position", "Same idea: assets, liabilities, and what's left over."],
    ["Income statement", "Statement of Activities", "Shows revenue and expenses, split by donor restriction."],
    ["Owners' equity", "Net assets", "No owners—the residual belongs to the mission."],
    ["Net income / profit", "Change in net assets", "A surplus isn't bad; it builds reserves."],
    ["Customers", "Donors, grantors, members, clients", "Many \"customers\" pay nothing; donors pay for others."],
    ["(not reported)", "Statement of Functional Expenses", "Shows program vs. support costs by type of expense."],
], [1.4, 1.8, 2.8])
H2("Fund accounting in a nutshell")
P("Historically, nonprofits kept separate sets of books—\"funds\"—for each pot of money: the "
  "building fund, the scholarship fund, the general fund. Modern GAAP simplified external "
  "reporting to two classes of net assets (Chapter 2), but the underlying idea survives. "
  "Internally, you will still want to <b>tag every transaction by its source and purpose</b> so "
  "you can prove how restricted money was used.")
P("Most accounting software handles this with <b>classes</b>, <b>tags</b>, <b>locations</b>, or "
  "<b>dimensions</b>. QuickBooks Online uses Classes and Locations; Xero uses Tracking Categories; "
  "nonprofit-specific systems such as Aplos, Sage Intacct, or Financial Edge have true fund "
  "modules. The tool matters less than the discipline: <i>every restricted dollar in, and every "
  "dollar spent from it, carries the same tag.</i>")
box("From the author: MissionLedger",
    "%s is nonprofit accounting software I built to make the practices in this handbook part "
    "of your everyday routine. See it at %s." % (ML, ML_LINK), "brand")
H2("Accrual vs. cash basis")
P("<b>Cash basis</b> records revenue when money arrives and expenses when money leaves. It is "
  "simple and many very small organizations use it for day-to-day bookkeeping.")
P("<b>Accrual basis</b> records revenue when it is earned or promised (for example, a signed "
  "multi-year pledge) and expenses when incurred, regardless of when cash moves. GAAP requires "
  "accrual, and most audits, many grantors, and the Form 990 (if your books are on accrual) "
  "expect it.")
box("Practical recommendation",
    ["Keep the books on accrual if you receive pledges, multi-year grants, or government "
     "funding, or if you expect an audit. If you are very small and cash-based, convert to "
     "accrual at year-end with a handful of adjusting entries (receivables, payables, prepaid "
     "expenses, and deferred revenue) so your annual statements are meaningful."])
H2("The five principles that run through this book")
numbered([
    "<b>Respect the restriction.</b> Donor intent is legally binding. Track it from the moment a gift arrives.",
    "<b>Classify by function.</b> Every expense serves programs, management, or fundraising.",
    "<b>Separate duties.</b> No single person should control a transaction from start to finish.",
    "<b>Close every month.</b> Small, regular reconciliations prevent large year-end surprises.",
    "<b>Report for decisions.</b> Board reports should answer questions, not just list numbers.",
])

# =====================================================================
chapter("CHAPTER 2", "Net Assets and Donor Restrictions",
        "The single most important concept in nonprofit accounting: some of your money comes with "
        "strings attached, and your books must show which.", "2 · Net Assets")
H2("The two classes of net assets")
P("Under FASB Accounting Standards Update (ASU) 2016-14, nonprofit net assets are reported in "
  "just two classes:")
table([
    ["Class", "What it is", "Examples"],
    ["<b>Without donor restrictions</b>", "Resources the board can use for any purpose consistent with the mission.",
     "General donations, unrestricted grants, program fees, investment income (unless restricted), board-designated reserves."],
    ["<b>With donor restrictions</b>", "Resources a donor or grantor limited by purpose, time, or both—including permanent endowments.",
     "A gift \"for the youth program,\" a pledge payable next year, a grant for a specific project, an endowment whose principal must be kept forever."],
], [1.5, 2.3, 3])
box("Board designations are NOT donor restrictions",
    "If your board votes to set aside $100,000 as an operating reserve, that money is still "
    "<b>without donor restrictions</b>. The board imposed the limit, so the board can lift it. "
    "You may show it as a separate line (\"board-designated\") within net assets without donor "
    "restrictions, and you should disclose it, but never move it into the restricted column.", "warn")
H2("Types of donor restrictions")
H3("Purpose restrictions")
P("The donor specifies <i>what</i> the money must be used for: \"for scholarships,\" \"for the "
  "new van,\" \"for our literacy program.\" The restriction is satisfied when you incur "
  "qualifying expenses.")
H3("Time restrictions")
P("The donor specifies <i>when</i> it can be used: \"for your 2027 operations,\" or implicitly, "
  "a pledge receivable in a future year. The restriction expires when the time arrives (or, for "
  "pledges, generally when the cash is due).")
H3("Perpetual restrictions (endowments)")
P("The donor requires that the original gift be maintained permanently, typically with "
  "investment returns available for spending. Most states have adopted the Uniform Prudent "
  "Management of Institutional Funds Act (UPMIFA), which governs how much of a donor-restricted "
  "endowment you may spend each year. Endowments call for professional advice and a written "
  "spending policy.")
H2("Releasing restrictions")
P("When you meet a restriction, you don't move cash—you <b>reclassify net assets</b> from "
  "\"with donor restrictions\" to \"without donor restrictions.\" On the Statement of Activities "
  "this appears as <b>Net assets released from restrictions</b>: a negative in the restricted "
  "column and an equal positive in the unrestricted column. Expenses themselves are always "
  "reported in the without-donor-restrictions column.")
P("<b>Example.</b> In March, the Harbor Foundation gives you $30,000 restricted to the summer "
  "reading camp. In July, you spend $30,000 running the camp.")
je("March — Receive restricted grant", [
    ("Cash — Operating", "30,000", ""),
    ("Contributions — With Donor Restrictions", "", "30,000"),
], "Tag: Fund = Summer Reading Camp")
je("July — Pay camp expenses", [
    ("Program Expenses — Summer Camp (salaries, supplies, etc.)", "30,000", ""),
    ("Cash — Operating", "", "30,000"),
], "Recorded as an expense without donor restrictions, function = Program")
je("July — Release the restriction", [
    ("Net Assets Released — With Donor Restrictions", "30,000", ""),
    ("Net Assets Released — Without Donor Restrictions", "", "30,000"),
], "Many organizations post this monthly or quarterly from a restricted-funds schedule.")
box("Simplification you may elect",
    "If a restricted contribution is received and spent in the <b>same reporting period</b>, GAAP "
    "permits you to report it directly as unrestricted, provided you apply the policy consistently "
    "and disclose it. Many small organizations elect this to cut down on release entries.", "tip")
H2("The restricted-funds tracker")
P("Keep a simple schedule (a spreadsheet is fine) listing every open restriction. Reconcile its "
  "total to the \"with donor restrictions\" net assets balance on your books every month.")
table([
    ["Donor / Grant", "Restriction", "Beg. balance", "Received", "Released", "End balance"],
    ["Harbor Foundation", "Summer camp 2026", "0", "30,000", "(30,000)", "0"],
    ["Smith Family", "Van purchase", "12,000", "8,000", "(20,000)", "0"],
    ["City Arts Council", "FY27 operations (time)", "0", "15,000", "0", "15,000"],
    ["Lee Endowment", "Perpetual — principal", "100,000", "0", "0", "100,000"],
    ["<b>Total</b>", "", "<b>112,000</b>", "<b>53,000</b>", "<b>(50,000)</b>", "<b>115,000</b>"],
], [1.6, 1.8, 1, 1, 1, 1], num_cols=(2, 3, 4, 5), total_rows=(5,))
P("Total ending balance must equal net assets with donor restrictions on your Statement of "
  "Financial Position. If it doesn't, something was coded to the wrong column.", "small")
SP(6)
box("Outgrowing the spreadsheet?",
    "When restricted gifts multiply, a spreadsheet tracker gets fragile. %s is nonprofit "
    "accounting software designed for organizations like yours. Learn more at %s."
    % (ML, ML_LINK), "brand")

# =====================================================================
chapter("CHAPTER 3", "Building Your Chart of Accounts",
        "A good chart of accounts makes every later step easier. A bad one quietly sabotages your "
        "reports for years.", "3 · Chart of Accounts")
H2("Design principles")
bullets([
    "<b>Use a numbering scheme.</b> Numbers keep accounts in statement order and make room for growth.",
    "<b>Mirror the Form 990.</b> If your expense accounts line up with Form 990 Part IX, year-end tax prep becomes a mapping exercise rather than a research project.",
    "<b>Keep it lean.</b> Use classes/tags for programs, funds, and grants—<i>not</i> separate accounts for every program. Fifty to a hundred accounts is plenty for most small organizations.",
    "<b>Separate restricted revenue.</b> Have distinct revenue accounts (or a restriction tag) for contributions with and without donor restrictions.",
])
H2("Recommended numbering structure")
table([
    ["Range", "Category", "Notes"],
    ["1000–1999", "Assets", "Cash, receivables, pledges, prepaid, investments, fixed assets"],
    ["2000–2999", "Liabilities", "Payables, accrued payroll, deferred revenue, loans"],
    ["3000–3999", "Net assets", "Without donor restrictions; with donor restrictions"],
    ["4000–4999", "Revenue & support", "Contributions, grants, program fees, events, investments"],
    ["5000–5999", "Personnel expenses", "Salaries, payroll taxes, benefits"],
    ["6000–6999", "Non-personnel expenses", "Occupancy, professional fees, supplies, travel, etc."],
    ["7000–7999", "Other / non-operating", "Gains/losses, depreciation (if kept separate)"],
], [1.1, 1.8, 4])
H2("Sample chart of accounts")
P("Adapt this starter chart to your organization. It is intentionally compact; add accounts only "
  "when a report or the Form 990 needs the detail.")
coa = [
    ["#", "Account name", "#", "Account name"],
    ["1000", "Cash — Operating Checking", "4000", "Contributions — Individuals"],
    ["1010", "Cash — Savings / Reserve", "4010", "Contributions — Corporate"],
    ["1050", "Petty Cash", "4020", "Foundation Grants"],
    ["1100", "Accounts Receivable", "4030", "Contributions — With Donor Restrictions"],
    ["1150", "Grants Receivable", "4100", "Government Grants (cost-reimbursement)"],
    ["1200", "Pledges Receivable", "4200", "Contributed Nonfinancial Assets (In-Kind)"],
    ["1210", "Allowance for Uncollectible Pledges", "4300", "Special Events — Gross Receipts"],
    ["1220", "Discount on Long-Term Pledges", "4310", "Special Events — Direct Benefit to Donors (contra)"],
    ["1300", "Prepaid Expenses", "4400", "Program Service Fees"],
    ["1400", "Investments", "4500", "Membership Dues"],
    ["1500", "Furniture &amp; Equipment", "4600", "Investment Income"],
    ["1510", "Vehicles", "4900", "Net Assets Released from Restrictions"],
    ["1590", "Accumulated Depreciation", "5000", "Salaries &amp; Wages"],
    ["2000", "Accounts Payable", "5100", "Payroll Taxes"],
    ["2100", "Accrued Payroll &amp; Vacation", "5200", "Employee Benefits"],
    ["2150", "Payroll Liabilities", "6000", "Professional Fees — Accounting/Legal"],
    ["2200", "Deferred Revenue", "6050", "Contract Services"],
    ["2300", "Refundable Advances (conditional grants)", "6100", "Rent &amp; Occupancy"],
    ["2500", "Notes / Loans Payable", "6200", "Office Supplies &amp; Expenses"],
    ["3000", "Net Assets Without Donor Restrictions", "6300", "Technology &amp; Software"],
    ["3010", "Board-Designated Net Assets", "6400", "Travel &amp; Conferences"],
    ["3100", "Net Assets With Donor Restrictions — Purpose/Time", "6500", "Insurance"],
    ["3200", "Net Assets With Donor Restrictions — Perpetual", "6600", "Program Supplies &amp; Direct Costs"],
    ["", "", "6700", "Advertising &amp; Promotion"],
    ["", "", "6800", "Bank &amp; Merchant Fees"],
    ["", "", "6900", "Depreciation"],
]
table(coa, [0.6, 2.7, 0.6, 2.9])
H2("Tags (classes) to set up alongside the chart")
table([
    ["Dimension", "Purpose", "Example values"],
    ["Function", "Program vs. support split for the Statement of Functional Expenses",
     "Program A, Program B, Management &amp; General, Fundraising"],
    ["Fund / Restriction", "Track restricted money", "Unrestricted, Harbor Fdn — Camp, Van Fund"],
    ["Grant", "Report to individual grantors", "DOE-2026-114, United Way FY27"],
    ["Location (optional)", "Multi-site organizations", "Main St. Center, Eastside Clinic"],
], [1.3, 2.5, 3])
box("Common mistake",
    "Creating separate expense accounts like \"Salaries — Youth Program\" and \"Salaries — "
    "Admin.\" This multiplies your chart and makes Form 990 mapping harder. Use one \"Salaries\" "
    "account and tag the function instead.", "warn")

# =====================================================================
chapter("CHAPTER 4", "Recording Revenue the Right Way",
        "Nonprofit revenue comes in many forms—gifts, grants, fees, events, and donated goods—"
        "and each follows its own rules.", "4 · Revenue")
H2("Step one: contribution or exchange?")
P("ASU 2018-08 gives a framework that settles most revenue questions. Ask: <b>Does the resource "
  "provider receive something of commensurate value in return?</b>")
table([
    ["", "Contribution", "Exchange transaction"],
    ["Definition", "Voluntary, nonreciprocal transfer. The giver gets nothing of equal value back.",
     "Each party gives and receives roughly equal value."],
    ["Examples", "Donations, most foundation grants, most government grants to further your mission",
     "Program fees, tuition, contracts where the payer gets the service, ticket sales (the fair-value portion)"],
    ["Accounting guidance", "ASC 958-605 (nonprofit contribution rules)", "ASC 606 (revenue from contracts with customers)"],
    ["Recognized when", "Received or unconditionally promised", "Performance obligations are satisfied"],
], [1.3, 2.7, 2.7])
P("Note that a grant from a government agency is often still a <b>contribution</b>: the public "
  "benefits, not the agency itself. It becomes an exchange only if the grantor receives "
  "commensurate value (for example, a contract to provide services directly to the agency).")
H2("Step two: conditional or unconditional?")
P("A contribution is <b>conditional</b> only if the agreement contains <b>both</b> (1) a barrier "
  "the organization must overcome and (2) a right of return of assets or a right of release from "
  "the promise. Common barriers include measurable performance targets (\"serve 500 students\"), "
  "matching requirements, and cost-reimbursement terms that limit spending to allowable costs.")
bullets([
    "<b>Unconditional:</b> recognize revenue now (in the restricted column if it carries a purpose or time restriction).",
    "<b>Conditional:</b> do <i>not</i> recognize revenue until the barrier is met. Cash received early is a liability (refundable advance).",
])
je("Cost-reimbursement government grant: $100,000 awarded, $40,000 of allowable costs incurred and billed", [
    ("Grants Receivable", "40,000", ""),
    ("Government Grants", "", "40,000"),
], "The remaining $60,000 is disclosed as a conditional promise, not booked as revenue.")
H2("Individual donations")
P("Record gifts at the date received (or the date of an unconditional pledge). Record the full "
  "gift amount as revenue and processing fees (credit card, PayPal, platform fees) as a separate "
  "expense—do not net them.")
je("Online gift of $100, platform keeps $3.20 fee", [
    ("Cash — Operating", "96.80", ""),
    ("Bank &amp; Merchant Fees", "3.20", ""),
    ("Contributions — Individuals", "", "100.00"),
])
H2("Pledges (promises to give)")
P("An unconditional promise to give—written or verbal but verifiable—is recorded as revenue "
  "and a receivable when made. Pledges payable in future periods are treated as time-restricted. "
  "Record an allowance for amounts you don't expect to collect, and discount pledges due beyond "
  "one year to present value.")
je("Board member pledges $15,000 payable $5,000/year for three years", [
    ("Pledges Receivable", "15,000", ""),
    ("Contributions — With Donor Restrictions (time)", "", "15,000"),
], "Simplified; GAAP requires discounting the long-term portion to present value.")
H2("Contributed nonfinancial assets (in-kind gifts)")
P("Donated goods, use of facilities, and certain services are revenue too. ASU 2020-07 requires "
  "them to be shown as a <b>separate line item</b> on the Statement of Activities, with "
  "disclosures about how each type was used and valued.")
table([
    ["Type", "Record it?", "How to value"],
    ["Goods (food, supplies, equipment)", "Yes", "Fair value at the date received"],
    ["Use of facilities / rent-free space", "Yes", "Fair rental value"],
    ["Professional services (CPA, attorney, IT)", "Yes, if specialized skills you would otherwise buy",
     "What you would have paid"],
    ["Services that create or enhance a nonfinancial asset", "Yes", "Fair value (e.g., volunteer carpenters building a shed)"],
    ["General volunteer time", "No (track hours for grant reports and your Form 990)", "n/a"],
], [2.4, 2.2, 2.2])
je("Local printer donates brochures worth $1,200 used for a fundraising mailing", [
    ("Advertising &amp; Promotion (Function: Fundraising)", "1,200", ""),
    ("Contributed Nonfinancial Assets", "", "1,200"),
])
H2("Special events")
P("Gala tickets, auctions, and golf outings mix contribution and exchange. If a $150 dinner "
  "ticket includes a $60 meal, $60 is an exchange (the donor got value) and $90 is a "
  "contribution. On Form 990, Part VIII line 8 reports gross event income separately from the "
  "contribution portion, less direct expenses.")
box("IRS rule: quid pro quo disclosures",
    ["When a donor pays <b>more than $75</b> and receives goods or services in return, you must "
     "provide a written statement telling them the deductible amount is limited to what they paid "
     "minus the fair market value of what they received, and give a good-faith estimate of that value. "
     "Penalties apply for failure. Put this language on tickets and receipts."], "note")
H2("Earned revenue and deferred revenue")
P("Program fees, tuition, and contracts follow ASC 606. If a family pays $1,200 in August for "
  "a September–December after-school program, record $1,200 as <b>deferred revenue</b> (a "
  "liability) and recognize $300 each month as the service is delivered.")
H2("Revenue recording quick-reference")
table([
    ["Situation", "Debit", "Credit"],
    ["Unrestricted cash gift", "Cash", "Contributions (without restrictions)"],
    ["Restricted gift", "Cash", "Contributions (with restrictions)"],
    ["Unconditional pledge", "Pledges Receivable", "Contributions (with restrictions — time)"],
    ["Conditional grant cash received before barrier met", "Cash", "Refundable Advance (liability)"],
    ["Barrier met on conditional grant", "Refundable Advance", "Grant Revenue"],
    ["Fee received in advance", "Cash", "Deferred Revenue"],
    ["In-kind goods used in program", "Program expense / asset", "Contributed Nonfinancial Assets"],
], [3, 1.8, 2.4])

# =====================================================================
chapter("CHAPTER 5", "Tracking Expenses by Function",
        "Donors, watchdogs, and the IRS all want to know the same thing: how much of your spending "
        "goes to the mission?", "5 · Functional Expenses")
H2("The three functional categories")
table([
    ["Function", "What belongs here", "Examples"],
    ["<b>Program services</b>", "Activities that carry out your mission and deliver benefits to clients, members, or the public.",
     "Teachers' salaries, food for a pantry, clinic supplies, program staff travel, outreach materials"],
    ["<b>Management &amp; general</b>", "Oversight, governance, and business management that supports the whole organization.",
     "Executive director's oversight time, accounting, audit, HR, board meetings, general insurance"],
    ["<b>Fundraising</b>", "Soliciting contributions, grants, and gifts.",
     "Development staff, donor database, grant-writing time, appeal mailings, event costs not benefiting attendees"],
], [1.5, 2.6, 2.7])
P("Membership-development costs may be a separate fourth category if significant. Note that "
  "the cost of goods sold and direct benefits to donors at events (such as meals) are not "
  "fundraising expenses; they are netted against related revenue or shown separately.")
H2("Allocating shared costs")
P("Many costs serve more than one function: rent for an office used by program and admin staff, "
  "or an executive director who runs programs, oversees operations, and courts major donors. You "
  "need a <b>reasonable, consistent, documented</b> allocation method.")
table([
    ["Cost", "Common allocation basis"],
    ["Salaries &amp; benefits", "Time records or periodic time studies (e.g., two representative weeks per quarter)"],
    ["Rent, utilities, janitorial", "Square footage used by each function"],
    ["Technology &amp; software", "Headcount or number of users per function"],
    ["Insurance", "Headcount, payroll, or specific identification by policy"],
    ["Depreciation", "Location / use of the asset"],
], [2, 4.8])
H3("Worked example: allocating rent by square footage")
table([
    ["Area", "Sq. ft.", "% of total", "Monthly rent share"],
    ["Classrooms (Program)", "2,400", "60%", "$3,000"],
    ["Admin offices (M&amp;G)", "1,000", "25%", "$1,250"],
    ["Development office (Fundraising)", "600", "15%", "$750"],
    ["<b>Total</b>", "<b>4,000</b>", "<b>100%</b>", "<b>$5,000</b>"],
], [2.8, 1.1, 1.1, 1.6], num_cols=(1, 2, 3), total_rows=(4,))
box("The \"overhead myth\" and why accuracy beats optics",
    ["It's tempting to code everything to programs so your program ratio looks great. Resist it. "
     "Under-reporting management costs is inaccurate, can be flagged in an audit, and feeds the "
     "harmful belief that good nonprofits have no overhead. Real organizations need accounting, "
     "technology, and leadership. Report honestly and explain your costs to donors."], "tip")
H2("Joint costs")
P("When one activity combines fundraising with program or management purposes—say, a mailing "
  "that both educates readers about a health issue and asks for a donation—special rules "
  "(ASC 958-720) determine whether costs can be split. All three criteria must be met: "
  "<b>purpose</b> (a real call to action beyond giving), <b>audience</b> (chosen for reasons other "
  "than ability to give), and <b>content</b> (supports program goals). If any test fails, the entire "
  "cost is fundraising.")
H2("Functional expense reporting")
P("ASU 2016-14 requires every nonprofit reporting under GAAP to present expenses by both "
  "<b>nature</b> (salaries, rent, supplies) and <b>function</b> (program, M&amp;G, fundraising) "
  "in one location—on the face of the Statement of Activities, in a separate statement, or in "
  "the notes. Form 990 Part IX asks for the same matrix, so build it into your monthly process.")

# =====================================================================
chapter("CHAPTER 6", "The Four Financial Statements",
        "Every complete set of nonprofit financial statements tells one story from four angles.",
        "6 · Financial Statements")
P("The examples below follow a fictional organization, <b>Brightpath Learning Center</b>, with "
  "about $700,000 in annual revenue.")
H2("1. Statement of Financial Position")
P("A snapshot of what you own and owe at a point in time. Assets are typically listed in order "
  "of liquidity; net assets are split by restriction.")
table([
    ["Brightpath Learning Center — June 30, 2026", "Amount"],
    ["<b>Assets</b>", ""],
    ["Cash and cash equivalents", "$184,500"],
    ["Grants and pledges receivable, net", "62,000"],
    ["Prepaid expenses", "8,300"],
    ["Investments", "100,000"],
    ["Property and equipment, net", "46,200"],
    ["<b>Total assets</b>", "<b>$401,000</b>"],
    ["<b>Liabilities</b>", ""],
    ["Accounts payable and accrued expenses", "$28,400"],
    ["Deferred revenue", "21,600"],
    ["<b>Total liabilities</b>", "<b>50,000</b>"],
    ["<b>Net assets</b>", ""],
    ["Without donor restrictions — undesignated", "156,000"],
    ["Without donor restrictions — board-designated reserve", "80,000"],
    ["With donor restrictions", "115,000"],
    ["<b>Total net assets</b>", "<b>351,000</b>"],
    ["<b>Total liabilities and net assets</b>", "<b>$401,000</b>"],
], [5, 1.8], num_cols=(1,), total_rows=(7, 11, 16, 17), zebra=False)
H2("2. Statement of Activities")
P("Revenue, expenses, and the change in net assets for the period, shown in columns by "
  "restriction. Note the \"released from restrictions\" line moving money between columns.")
table([
    ["Year ended June 30, 2026", "Without donor restrictions", "With donor restrictions", "Total"],
    ["Contributions", "$212,000", "$53,000", "$265,000"],
    ["Foundation &amp; government grants", "190,000", "—", "190,000"],
    ["Contributed nonfinancial assets", "18,000", "—", "18,000"],
    ["Program service fees", "168,000", "—", "168,000"],
    ["Special events, net of $9,000 direct benefits", "41,000", "—", "41,000"],
    ["Investment income", "6,000", "—", "6,000"],
    ["Net assets released from restrictions", "50,000", "(50,000)", "—"],
    ["<b>Total revenue and support</b>", "<b>685,000</b>", "<b>3,000</b>", "<b>688,000</b>"],
    ["Program services", "512,000", "", "512,000"],
    ["Management and general", "92,000", "", "92,000"],
    ["Fundraising", "61,000", "", "61,000"],
    ["<b>Total expenses</b>", "<b>665,000</b>", "", "<b>665,000</b>"],
    ["<b>Change in net assets</b>", "<b>20,000</b>", "<b>3,000</b>", "<b>23,000</b>"],
    ["Net assets, beginning of year", "216,000", "112,000", "328,000"],
    ["<b>Net assets, end of year</b>", "<b>$236,000</b>", "<b>$115,000</b>", "<b>$351,000</b>"],
], [2.8, 1.4, 1.4, 1.2], num_cols=(1, 2, 3), total_rows=(8, 12, 13, 15), zebra=False)
P("Program ratio: 512,000 / 665,000 = <b>77%</b> of expenses went to programs.", "small")
SP(6)
H2("3. Statement of Functional Expenses")
P("A matrix of expenses by nature (rows) and function (columns). Abbreviated example:")
table([
    ["Expense", "Program", "Mgmt &amp; general", "Fundraising", "Total"],
    ["Salaries and wages", "$318,000", "$52,000", "$38,000", "$408,000"],
    ["Payroll taxes and benefits", "64,000", "10,000", "8,000", "82,000"],
    ["Rent and occupancy", "36,000", "15,000", "9,000", "60,000"],
    ["Program supplies", "52,000", "—", "—", "52,000"],
    ["Professional fees", "8,000", "11,000", "2,000", "21,000"],
    ["Technology", "9,000", "3,000", "3,000", "15,000"],
    ["Other", "25,000", "1,000", "1,000", "27,000"],
    ["<b>Total</b>", "<b>$512,000</b>", "<b>$92,000</b>", "<b>$61,000</b>", "<b>$665,000</b>"],
], [2.3, 1.1, 1.2, 1.1, 1.1], num_cols=(1, 2, 3, 4), total_rows=(8,))
H2("4. Statement of Cash Flows")
P("Explains how cash changed during the year, in three sections: <b>operating</b> (day-to-day "
  "activities), <b>investing</b> (buying or selling equipment and investments), and "
  "<b>financing</b> (loans, and contributions restricted to long-term purposes such as endowments "
  "or buildings). Most nonprofits use the indirect method, starting with the change in net assets "
  "and adjusting for non-cash items like depreciation and changes in receivables and payables.")
H2("Required liquidity disclosure")
P("GAAP also requires a note describing how you manage liquidity and a quantitative table of "
  "financial assets available to meet general expenditures within one year. It's one of the "
  "most useful pieces of information you can give your board.")
table([
    ["Financial assets available within one year", "Amount"],
    ["Cash and cash equivalents", "$184,500"],
    ["Receivables due within one year", "57,000"],
    ["Investments", "100,000"],
    ["Less: amounts with donor restrictions", "(115,000)"],
    ["Less: board-designated reserve", "(80,000)"],
    ["<b>Available for general expenditure</b>", "<b>$146,500</b>"],
], [5, 1.8], num_cols=(1,), total_rows=(6,))
P("At annual expenses of $665,000 (about $55,400/month), Brightpath has roughly <b>2.6 months</b> "
  "of readily available operating cash.", "small")

# =====================================================================
chapter("CHAPTER 7", "Budgeting and Cash Flow Management",
        "A budget is the board's plan in numbers. Cash flow is what keeps the lights on while "
        "you carry it out.", "7 · Budgeting & Cash")
H2("Building the annual operating budget")
numbered([
    "<b>Start with programs.</b> List planned activities and their costs. Mission drives the budget, not the other way around.",
    "<b>Estimate revenue conservatively.</b> Separate committed funds (signed grants, pledges) from probable and hopeful sources. Budget only what you can defend.",
    "<b>Build personnel costs line by line.</b> Salaries, payroll taxes (roughly 8–10% of wages for employer FICA, unemployment, and workers' comp, varying by state), and benefits are usually 60–80% of spending.",
    "<b>Add shared costs and allocate by function</b> using the same methods as your actuals (Chapter 5).",
    "<b>Include a contingency and a contribution to reserves.</b> A balanced budget with zero margin leaves no room for surprises.",
    "<b>Cash-flow the budget by month.</b> Revenue is lumpy (year-end giving, grant cycles); expenses are steady.",
    "<b>Board approval.</b> The board formally adopts the budget, ideally before the fiscal year begins.",
])
H2("Budget vs. actual reporting")
P("Each month, compare actual results to budget, year-to-date, with a short narrative explaining "
  "significant variances. Set a threshold—for example, any line off by more than 10% <i>and</i> "
  "$2,000—so the board focuses on what matters.")
table([
    ["Line", "YTD budget", "YTD actual", "Variance", "%", "Comment"],
    ["Individual contributions", "$120,000", "$98,500", "($21,500)", "-18%", "Spring appeal underperformed; year-end campaign planned"],
    ["Foundation grants", "95,000", "110,000", "15,000", "16%", "New Harbor Foundation award"],
    ["Salaries", "204,000", "199,800", "4,200", "2%", "Within range"],
    ["Program supplies", "26,000", "31,200", "(5,200)", "-20%", "Enrollment higher than planned; offset by fees"],
], [1.7, 0.9, 0.9, 0.9, 0.6, 2.4], num_cols=(1, 2, 3, 4))
H2("Cash flow forecasting")
P("Keep a rolling 13-week or 12-month cash forecast: beginning cash, plus expected receipts, "
  "minus expected disbursements, equals ending cash. Update it monthly. Watch for:")
bullets([
    "<b>Reimbursement lag.</b> Government grants often pay 30–90 days after you spend.",
    "<b>Seasonality.</b> Many organizations receive a large share of individual giving in November and December.",
    "<b>Payroll timing.</b> Months with three payrolls (for biweekly schedules) strain cash.",
    "<b>Restricted cash.</b> Cash in the bank is not all yours to spend—subtract restricted balances.",
])
H2("Operating reserves")
P("An operating reserve is a board-designated pool of unrestricted net assets that cushions "
  "against shortfalls and lets you seize opportunities. Many advisors suggest a target of "
  "<b>three to six months</b> of operating expenses. Write a reserve policy covering the target, "
  "who can authorize use, and how the reserve will be replenished.")
H2("Key financial ratios to track")
table([
    ["Ratio", "Formula", "What it tells you"],
    ["Months of cash", "Unrestricted cash ÷ average monthly expenses", "How long you could operate with no new revenue"],
    ["Program expense ratio", "Program expenses ÷ total expenses", "Share of spending going to mission delivery"],
    ["Fundraising efficiency", "Fundraising expenses ÷ contributions raised", "Cost to raise $1"],
    ["Current ratio", "Current assets ÷ current liabilities", "Ability to pay near-term bills (aim > 1.5)"],
    ["Revenue concentration", "Largest source ÷ total revenue", "Dependence on any single funder"],
    ["Operating margin", "Change in unrestricted net assets ÷ unrestricted revenue", "Whether operations are sustainable"],
], [1.6, 2.6, 2.6])

# =====================================================================
chapter("CHAPTER 8", "Internal Controls for Small Teams",
        "Fraud in nonprofits is usually not dramatic. It's a trusted person with too much access "
        "and too little review.", "8 · Internal Controls")
H2("Why controls matter more for nonprofits")
P("Small organizations are especially vulnerable: they tend to run on trust, have few staff, "
  "and lack the budget for a large finance team. Good controls protect your assets and your "
  "reputation—and they protect honest staff from suspicion.")
H2("Segregation of duties")
P("The core idea: split each transaction among different people so no single person can "
  "<b>authorize</b>, <b>record</b>, and <b>have custody</b> of the same asset.")
table([
    ["Process", "Person A", "Person B", "Person C (often a board member)"],
    ["Cash receipts", "Opens mail, logs checks, endorses \"for deposit only\"", "Records deposit in the books",
     "Compares log to bank deposits monthly"],
    ["Disbursements", "Approves invoice (budget holder)", "Enters bill, prepares payment",
     "Signs/releases payment; second signer over a set limit"],
    ["Payroll", "Approves timesheets", "Processes payroll",
     "Reviews payroll register and headcount changes"],
    ["Bank reconciliation", "—", "Prepares reconciliation",
     "Reviews and signs; sees bank statement directly"],
], [1.3, 1.8, 1.7, 2.1])
box("If you have only one or two people",
    ["Perfect segregation may be impossible. Compensate with <b>board oversight</b>: have the "
     "treasurer receive bank statements directly (or have read-only online access), review "
     "monthly reconciliations, approve payments above a threshold, and review the payroll register."], "tip")
H2("Essential controls checklist")
checklist([
    "Written financial policies approved by the board (signing authority, credit cards, reimbursements, reserves).",
    "Two signatures or dual approval for payments above a set dollar amount.",
    "Bank and credit card accounts reconciled monthly and reviewed by someone other than the preparer.",
    "Donations deposited promptly (within a few business days); no cash kept on premises overnight beyond petty cash.",
    "Two people count cash at events; both sign the count sheet.",
    "Vendor master file changes (especially bank account changes) verified by phone using a known number.",
    "Company credit cards with individual limits; receipts and business purpose required for every charge.",
    "Payroll changes approved in writing; periodic headcount check against the payroll register.",
    "Accounting software user permissions limited to what each person needs; closed periods locked.",
    "Backups of financial data and multi-factor authentication on banking and accounting systems.",
    "Conflict of interest policy with annual disclosure statements from board and key staff.",
    "Whistleblower policy and document retention/destruction policy (both asked about on Form 990).",
])
H2("Red flags of fraud")
bullets([
    "An employee who never takes vacation or resists sharing duties.",
    "Missing or altered bank statements; reconciliations always \"in progress.\"",
    "New vendors with P.O. box addresses or no web presence.",
    "Unusual round-dollar payments or payments just under approval limits.",
    "Donors reporting that their gifts were not acknowledged.",
    "Lifestyle that doesn't match known income.",
])
box("Business email compromise is the #1 modern threat",
    "Criminals impersonate executives or vendors by email, requesting urgent wire transfers, gift "
    "card purchases, or changes to bank account details. Rule: <b>never change payment "
    "instructions based on email alone.</b> Call the vendor or executive at a number you "
    "already have on file.", "warn")

# =====================================================================
chapter("CHAPTER 9", "Grants Management and Federal Awards",
        "Grants are a partnership with obligations. Tracking them well wins you the next grant.",
        "9 · Grants")
H2("The grant lifecycle")
numbered([
    "<b>Pre-award:</b> Build the budget with your finance lead, including indirect costs. Confirm you can meet match and reporting requirements.",
    "<b>Award:</b> Read the agreement closely. Note restrictions, conditions, allowable costs, reporting dates, and whether it's a contribution or exchange (Chapter 4).",
    "<b>Setup:</b> Create a grant tag/class in your software and a file with the agreement, budget, and reporting calendar.",
    "<b>Spending:</b> Code every expense to the grant tag. Keep documentation that each cost is allowable.",
    "<b>Reporting:</b> Reconcile grant expenses to the general ledger before each report is submitted.",
    "<b>Closeout:</b> Submit final reports, return unspent funds if required, and retain records (often at least three years after the final report).",
])
H2("Federal awards and the Uniform Guidance")
P("If you receive federal money—directly or passed through a state, county, or another "
  "nonprofit—you are subject to the Office of Management and Budget's <b>Uniform Guidance</b> "
  "(2 CFR Part 200). Key points under the 2024 revisions, effective for awards and fiscal years "
  "beginning on or after October 1, 2024:")
table([
    ["Requirement", "What to know"],
    ["Single Audit", "Required if you <b>spend $1,000,000 or more</b> in federal awards in a fiscal year (previously $750,000). Due within 30 days after the audit report or nine months after year-end, whichever is earlier."],
    ["De minimis indirect cost rate", "Organizations without a negotiated rate may charge up to <b>15%</b> of modified total direct costs (previously 10%)."],
    ["Equipment threshold", "Items costing <b>$10,000 or more</b> per unit (previously $5,000) are equipment subject to tracking rules."],
    ["Written policies", "Procurement, conflicts of interest, travel, financial management, and property management policies are required."],
    ["Time and effort", "Salaries charged to federal awards must be supported by records that accurately reflect the work performed."],
    ["Cost principles", "Only allowable, allocable, and reasonable costs may be charged. Alcohol, entertainment, lobbying, and fundraising are generally unallowable."],
], [1.7, 5.1])
box("Check the date rules",
    "Thresholds above apply under the 2024 Uniform Guidance revisions. Older awards may still be "
    "governed by previous terms. Confirm with your award documents and grants officer.", "note")
H2("Indirect costs")
P("Indirect costs (also called overhead or F&amp;A) are shared costs that can't be easily tied "
  "to one project: accounting, HR, IT, general rent. Recover them by including an indirect rate "
  "in grant budgets—either your federally negotiated rate, the de minimis rate, or the rate "
  "a private funder allows. Many foundations now accept 15–25% or more; ask.")
H2("Grant tracking worksheet")
table([
    ["Grant", "Award", "Period", "Spent to date", "Remaining", "Next report", "Match req."],
    ["Harbor Fdn — Camp", "$30,000", "1/26–12/26", "$30,000", "$0", "1/15/27", "None"],
    ["State Ed. Dept.", "$120,000", "7/26–6/27", "$38,400", "$81,600", "10/31/26", "10%"],
    ["United Way", "$45,000", "7/26–6/27", "$11,250", "$33,750", "1/31/27", "None"],
], [1.6, 0.9, 1.1, 1, 1, 1, 0.8], num_cols=(1, 3, 4))

# =====================================================================
chapter("CHAPTER 10", "IRS Compliance: Form 990, Receipts, and UBIT",
        "Tax-exempt doesn't mean exempt from filing. Staying in good standing takes a few "
        "predictable steps each year.", "10 · IRS Compliance")
H2("Which Form 990 do you file?")
table([
    ["Form", "Who files", "Notes"],
    ["990-N (e-Postcard)", "Gross receipts normally $50,000 or less",
     "Short online filing. Cannot be filed late via extension—just file it."],
    ["990-EZ", "Gross receipts under $200,000 <b>and</b> total assets under $500,000",
     "Short form; may file the full 990 instead if preferred. Filed electronically."],
    ["990", "Gross receipts $200,000 or more, <b>or</b> total assets $500,000 or more",
     "Full return with schedules. Public document posted online."],
    ["990-PF", "Private foundations (regardless of size)", "Different rules, including excise tax on investment income."],
], [1.5, 2.8, 2.5])
P("Churches and certain church-affiliated organizations are generally not required to file. "
  "Check the IRS instructions for other exceptions.", "small")
H2("Deadlines and the three-year rule")
bullets([
    "<b>Due date:</b> the 15th day of the 5th month after your fiscal year-end (May 15 for calendar-year organizations; November 15 for June 30 year-ends).",
    "<b>Extension:</b> File Form 8868 for an automatic six-month extension (not available for the 990-N).",
    "<b>Automatic revocation:</b> If you fail to file for <b>three consecutive years</b>, your tax-exempt status is automatically revoked. Reinstatement is possible but painful.",
    "<b>Public inspection:</b> You must provide copies of your three most recent 990s and your exemption application on request (or make them widely available online).",
])
H2("What the full Form 990 asks about")
P("The Form 990 is as much a governance questionnaire as a tax return. Expect questions on:")
bullets([
    "Mission, program accomplishments, and expenses for your three largest programs.",
    "Board independence, compensation of officers and key employees, and how compensation is set.",
    "Whether you have conflict of interest, whistleblower, and document retention policies.",
    "Whether the board reviewed the 990 before filing.",
    "Revenue by source (Part VIII) and expenses by nature and function (Part IX).",
    "Schedule A (public support test), Schedule B (major contributors, generally $5,000+), and others as applicable.",
])
box("Tip: share the draft with the board",
    "Form 990 Part VI asks whether a copy was provided to the governing body before filing and "
    "to describe the process. Sending the draft to the full board, with time to ask questions, "
    "is good practice and a good look to donors who read your 990.", "tip")
H2("Public support test (Schedule A)")
P("To remain a <b>public charity</b> rather than a private foundation, most 501(c)(3)s must show "
  "broad public support—generally that at least <b>33⅓%</b> of total support over a "
  "five-year period comes from the public (with a facts-and-circumstances test down to 10%). "
  "Large gifts from a single donor count only up to 2% of total support. Monitor this if you rely "
  "heavily on a few large donors.")
H2("Donor acknowledgments")
P("Donors cannot deduct any single contribution of <b>$250 or more</b> without a contemporaneous "
  "written acknowledgment from you. It must include:")
checklist([
    "Your organization's name.",
    "The amount of cash, or a description (but not the value) of non-cash property.",
    "A statement of whether you provided any goods or services in return.",
    "If so, a description and good-faith estimate of their value (or a statement that only intangible religious benefits were provided).",
])
P("\"Contemporaneous\" means the donor receives it by the earlier of the date they file their "
  "return or its due date. Best practice: acknowledge every gift within 48 hours, and send an "
  "annual giving summary in January. A template is in Appendix A.")
H2("Non-cash gifts")
bullets([
    "<b>Over $500:</b> the donor files Form 8283 with their return.",
    "<b>Over $5,000</b> (most property): the donor generally needs a qualified appraisal, and you sign Section B of their Form 8283.",
    "<b>If you sell or dispose of</b> property reported in Section B within three years, file <b>Form 8282</b> within 125 days.",
    "<b>Donated vehicles</b> over $500 have special rules and require Form 1098-C.",
    "Never put a value on a donor's non-cash gift in your acknowledgment; valuation is the donor's job.",
])
H2("Unrelated business income tax (UBIT)")
P("Income from a <b>trade or business</b>, <b>regularly carried on</b>, that is <b>not "
  "substantially related</b> to your exempt purpose is taxable. Examples might include selling "
  "advertising in your newsletter or renting your parking lot to the public on weekdays.")
P("Common exclusions: work done substantially by volunteers, sale of donated goods (thrift "
  "stores), activities for the convenience of members or clients, and most passive income "
  "(dividends, interest, royalties, and most real property rent not financed by debt).")
P("If gross unrelated business income is <b>$1,000 or more</b>, file <b>Form 990-T</b>.")
H2("Payroll and contractor reporting")
bullets([
    "Nonprofits withhold and pay income tax, Social Security, and Medicare like any employer. 501(c)(3)s are exempt from federal unemployment tax (FUTA), but state rules vary.",
    "Issue Form 1099-NEC to unincorporated contractors paid above the reporting threshold. The threshold was $600 for many years; recent federal legislation raised it to $2,000 for payments made after 2025. Confirm the current figure each year.",
    "Collect a Form W-9 from every vendor <i>before</i> the first payment.",
    "Classify workers carefully. Calling an employee a \"contractor\" exposes you to back taxes and penalties.",
])
H2("State compliance")
P("Most states require charities to register before soliciting donations from residents, and "
  "many require an annual report, often with financial statements. Some require a CPA review or "
  "audit above revenue thresholds that vary widely by state. Online fundraising may trigger "
  "registration in multiple states. Check with your state attorney general or secretary of state "
  "and keep a compliance calendar.")

# =====================================================================
chapter("CHAPTER 11", "The Monthly Close and Annual Calendar",
        "A consistent close turns bookkeeping from a scramble into a routine.",
        "11 · Monthly Close")
H2("Month-end close checklist")
P("Aim to close within 10–15 business days of month-end. Copy this checklist into your task "
  "manager and assign each step an owner.")
H3("Week 1: Capture everything")
checklist([
    "Record all deposits, donations, and online giving payouts (match platform reports to bank deposits).",
    "Enter all bills received; record accrual for significant unbilled expenses.",
    "Record payroll and verify payroll liabilities match the payroll provider's reports.",
    "Code credit card transactions; collect missing receipts.",
    "Record in-kind gifts received during the month.",
])
H3("Week 2: Reconcile")
checklist([
    "Reconcile every bank, savings, and credit card account to the statement.",
    "Reconcile donor database (CRM) totals to contribution revenue in the books.",
    "Reconcile grants and pledges receivable to the detail schedule.",
    "Reconcile the restricted-funds tracker to net assets with donor restrictions.",
    "Post net assets released from restrictions.",
    "Review accounts payable and receivable aging; follow up on old items.",
    "Record depreciation, prepaid expense amortization, and deferred revenue recognition.",
])
H3("Week 3: Review and report")
checklist([
    "Review the trial balance for odd balances (negative cash, credit balances in expense accounts).",
    "Check that every expense has a function tag and grant expenses are coded to grants.",
    "Prepare statements: financial position, activities, budget vs. actual, cash forecast.",
    "Write a one-page narrative of key variances and issues.",
    "Lock the period in your accounting software.",
    "Send the package to the executive director and treasurer.",
])
box("Rather hand off the monthly close?",
    "%s can take bookkeeping off your plate, so you can focus on the mission. Learn more at %s."
    % (FB, FB_LINK), "brand")
H2("Annual compliance calendar")
P("For a calendar-year (January–December) organization. Shift dates for other fiscal years.")
table([
    ["When", "Task"],
    ["January", "Annual donor giving statements; W-2s to employees and Forms 1099-NEC to contractors (due January 31); Form W-3 and 1099 filings with IRS/SSA"],
    ["January–February", "Year-end close and adjusting entries; inventory of fixed assets"],
    ["Feb–April", "Audit or review fieldwork (if applicable); state registration renewals (dates vary)"],
    ["Quarterly", "Form 941 payroll tax returns (April 30, July 31, October 31, January 31)"],
    ["May 15", "Form 990 / 990-EZ / 990-N and 990-T due (or file Form 8868 for extension)"],
    ["Spring", "Board reviews draft 990 and audit report; annual conflict of interest disclosures"],
    ["Summer", "Mid-year budget re-forecast"],
    ["September–October", "Draft next year's budget; review insurance coverage"],
    ["November 15", "Extended Form 990 deadline"],
    ["November–December", "Board adopts budget; year-end giving campaign; ensure December gifts are dated correctly"],
], [1.6, 5.2])
box("Year-end gift dating",
    "A check is considered delivered on the date it is mailed (postmark) if it clears in due "
    "course. Online and credit card gifts count on the date the charge is authorized. Keep "
    "postmarked envelopes for late-December checks.", "note")

# =====================================================================
chapter("CHAPTER 12", "Audits, Reviews, and Your Board",
        "Independent assurance and strong board oversight are the two pillars of financial trust.",
        "12 · Audits & Board")
H2("Audit, review, or compilation?")
table([
    ["Service", "What the CPA does", "Assurance", "Typical use"],
    ["Compilation", "Assembles statements from your records; no testing", "None", "Small organizations wanting professional-format statements"],
    ["Review", "Analytical procedures and inquiries", "Limited", "Mid-sized organizations; some state thresholds and funders"],
    ["Audit", "Tests transactions, controls, and balances; confirms with third parties", "Reasonable (highest)", "State thresholds, large funders, lenders, Single Audit"],
], [1.2, 2.4, 1.2, 2.2])
P("Audit requirements come from three places: your <b>state</b> (charity registration "
  "thresholds), your <b>funders</b> (grant agreements), and <b>federal law</b> (Single Audit at "
  "$1,000,000 in federal expenditures). Even if not required, an audit can open doors to larger "
  "grants.")
H2("Preparing for your first audit")
checklist([
    "Ask the auditor for their \"prepared by client\" (PBC) list early.",
    "Close the year and reconcile every balance sheet account to supporting detail.",
    "Gather all grant agreements, pledge documentation, and gift acknowledgment records.",
    "Pull board minutes for the year, including budget approval and major decisions.",
    "Prepare fixed asset and depreciation schedules.",
    "Document your functional allocation methods.",
    "Assemble policies: financial, conflict of interest, whistleblower, document retention.",
    "Designate one point person to coordinate requests.",
])
box("Books not audit-ready?",
    "If your books need cleanup before an audit or review, %s can help you get caught up. "
    "Visit %s." % (FB, FB_LINK), "brand")
H2("The board's financial responsibilities")
P("Board members have a <b>fiduciary duty</b>—the duties of care, loyalty, and obedience. "
  "Financially, that means the board should:")
bullets([
    "Approve the annual budget and monitor results against it at least quarterly.",
    "Adopt key financial policies and review them periodically.",
    "Ensure required filings (990, state registrations, payroll taxes) are made on time.",
    "Hire the auditor and meet with them directly, including without staff present.",
    "Set executive compensation using comparable data and document the process.",
    "Protect the organization's reserves and long-term sustainability.",
])
box("Payroll taxes: a personal-liability warning",
    "Unpaid payroll withholding taxes can trigger the Trust Fund Recovery Penalty, which the IRS "
    "can assess <b>personally</b> against individuals responsible for paying them—including "
    "officers and, in some cases, board members. Never use withheld taxes to cover cash shortfalls.",
    "warn")
H2("The one-page board dashboard")
P("Most board members are not accountants. Give them a single page they can understand in two "
  "minutes, with the full statements attached:")
table([
    ["Metric", "This month", "Target / prior year", "Status"],
    ["Unrestricted cash (months of expenses)", "2.6", "3.0", "Watch"],
    ["YTD revenue vs. budget", "96%", "100%", "Watch"],
    ["YTD expenses vs. budget", "94%", "100%", "On track"],
    ["YTD change in unrestricted net assets", "+$20,000", "+$15,000", "On track"],
    ["Program expense ratio", "77%", "75%+", "On track"],
    ["Largest funder % of revenue", "18%", "< 25%", "On track"],
    ["Filings and payroll taxes current?", "Yes", "Yes", "On track"],
], [2.8, 1.2, 1.5, 1.2])

# =====================================================================
chapter("APPENDIX A", "Templates and Worksheets", "Copy and adapt these for use within your "
        "organization.", "Appendix A · Templates")
H2("A-1. Gift acknowledgment letter")
ack = [
    "[Organization letterhead]",
    "[Date]",
    "Dear [Donor name],",
    "Thank you for your generous gift of <b>$[amount]</b> received on <b>[date]</b> to "
    "[Organization name]. Your support helps us [one sentence describing impact].",
    "<b>[Choose one]</b> No goods or services were provided in exchange for this contribution. "
    "<b>&mdash; or &mdash;</b> In exchange for your contribution, you received [description], with "
    "an estimated fair market value of $[value]. The amount of your contribution that is deductible "
    "for federal income tax purposes is limited to the excess of your payment over this value.",
    "[Organization name] is a tax-exempt organization under Section 501(c)(3) of the Internal "
    "Revenue Code. Our federal EIN is [XX-XXXXXXX]. Please keep this letter for your tax records.",
    "With gratitude,",
    "[Name], [Title]",
]
ack_p = [Paragraph(a, S["boxbody"]) for a in ack]
t = Table([[ack_p]], colWidths=[doc.width])
t.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0.8, GRID), ("LEFTPADDING", (0, 0), (-1, -1), 16),
                       ("RIGHTPADDING", (0, 0), (-1, -1), 16), ("TOPPADDING", (0, 0), (-1, -1), 12),
                       ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
story.append(t)
P("For non-cash gifts, replace the amount with a description of the property, e.g., \"a 2019 "
  "Dell laptop\" and do <b>not</b> state its value.", "small")
story.append(CondPageBreak(4 * inch))
H2("A-2. Bank reconciliation worksheet")
blank = "_______________"
table([
    ["Bank reconciliation — Account: ____________   Month ending: ____________", "Amount"],
    ["Balance per bank statement", blank],
    ["Add: deposits in transit (list)", blank],
    ["Less: outstanding checks (list)", "(" + blank + ")"],
    ["Add/less: bank errors", blank],
    ["<b>Adjusted bank balance</b>", "<b>" + blank + "</b>"],
    ["Balance per general ledger", blank],
    ["Add: interest earned not yet recorded", blank],
    ["Less: bank fees / NSF items not yet recorded", "(" + blank + ")"],
    ["<b>Adjusted book balance</b>", "<b>" + blank + "</b>"],
    ["Difference (must be zero)", blank],
    ["Prepared by / date: __________________   Reviewed by / date: __________________", ""],
], [5, 1.8], num_cols=(1,), total_rows=(5, 9), zebra=False)
H2("A-3. Annual operating budget template")
table([
    ["Line item", "Program A", "Program B", "M&amp;G", "Fundraising", "Total"],
    ["<b>Revenue</b>", "", "", "", "", ""],
    ["Individual contributions", "", "", "", "", ""],
    ["Foundation grants", "", "", "", "", ""],
    ["Government grants", "", "", "", "", ""],
    ["Program fees", "", "", "", "", ""],
    ["Special events (net)", "", "", "", "", ""],
    ["Other", "", "", "", "", ""],
    ["<b>Total revenue</b>", "", "", "", "", ""],
    ["<b>Expenses</b>", "", "", "", "", ""],
    ["Salaries", "", "", "", "", ""],
    ["Payroll taxes &amp; benefits", "", "", "", "", ""],
    ["Rent &amp; occupancy", "", "", "", "", ""],
    ["Program supplies", "", "", "", "", ""],
    ["Professional fees", "", "", "", "", ""],
    ["Technology", "", "", "", "", ""],
    ["Insurance", "", "", "", "", ""],
    ["Other", "", "", "", "", ""],
    ["<b>Total expenses</b>", "", "", "", "", ""],
    ["<b>Surplus / (deficit)</b>", "", "", "", "", ""],
], [2.2, 1, 1, 1, 1, 1], total_rows=(8, 18, 19), zebra=False)
H2("A-4. Time study log (for allocating salaries)")
table([
    ["Employee: ______________   Week of: ______________", "Mon", "Tue", "Wed", "Thu", "Fri", "Total"],
    ["Program A", "", "", "", "", "", ""],
    ["Program B", "", "", "", "", "", ""],
    ["Management &amp; general", "", "", "", "", "", ""],
    ["Fundraising", "", "", "", "", "", ""],
    ["<b>Total hours</b>", "", "", "", "", "", ""],
    ["Employee signature: ______________   Supervisor: ______________", "", "", "", "", "", ""],
], [3, 0.6, 0.6, 0.6, 0.6, 0.6, 0.7], total_rows=(5,), zebra=False)
story.append(CondPageBreak(4 * inch))
H2("A-5. Financial policies starter list")
P("Board-approved written policies every nonprofit should have:")
checklist([
    "Signing authority and approval limits",
    "Expense reimbursement and travel",
    "Credit card use",
    "Gift acceptance (what gifts you will and won't take, especially non-cash)",
    "Operating reserve",
    "Investment policy (if you hold investments)",
    "Conflict of interest, with annual disclosure form",
    "Whistleblower protection",
    "Document retention and destruction",
    "Executive compensation review process",
    "Procurement (required for federal awards)",
    "Capitalization threshold (e.g., items over $2,500 are recorded as fixed assets)",
])

# =====================================================================
chapter("APPENDIX B", "Quick-Reference Cheat Sheet", None, "Appendix B · Cheat Sheet")
table([
    ["Topic", "Rule of thumb"],
    ["Net asset classes", "Two: without donor restrictions, and with donor restrictions"],
    ["Board-designated funds", "Without donor restrictions (board can undo it)"],
    ["Restriction met", "Reclassify via \"net assets released from restrictions\""],
    ["Contribution vs. exchange", "Did the payer get commensurate value? Yes = exchange (ASC 606)"],
    ["Conditional contribution", "Barrier + right of return/release = don't recognize until barrier met"],
    ["Unconditional pledge", "Record as revenue and receivable now; future years = time-restricted"],
    ["In-kind gifts", "Separate line item; services only if specialized or create an asset"],
    ["Volunteer time (general)", "Not recorded as revenue"],
    ["Functional categories", "Program, management &amp; general, fundraising"],
    ["Donor receipt required", "Any single gift of $250+"],
    ["Quid pro quo disclosure", "Payment over $75 with goods/services received"],
    ["Form 990-N", "Gross receipts normally ≤ $50,000"],
    ["Form 990-EZ", "Gross receipts &lt; $200,000 and total assets &lt; $500,000"],
    ["Form 990 due", "15th day of 5th month after year-end; +6 months with Form 8868"],
    ["Automatic revocation", "Three consecutive years of not filing"],
    ["Form 990-T", "Gross unrelated business income of $1,000+"],
    ["Single Audit", "$1,000,000+ federal expenditures (FY beginning on/after 10/1/2024)"],
    ["De minimis indirect rate", "15% of modified total direct costs (2024 Uniform Guidance)"],
    ["Public support test", "Generally 33⅓% public support over five years"],
    ["Operating reserve target", "Commonly 3–6 months of operating expenses"],
    ["Close cadence", "Reconcile and close monthly within 10–15 business days"],
], [2.2, 4.6])

# =====================================================================
chapter("APPENDIX C", "Glossary", None, "Appendix C · Glossary")
gloss = [
    ("Accrual basis", "Recording revenue when earned or promised and expenses when incurred, regardless of when cash changes hands."),
    ("ASC 958", "The section of the FASB Accounting Standards Codification governing not-for-profit entities."),
    ("Board-designated net assets", "Unrestricted net assets the board has set aside for a specific purpose, such as a reserve. The board may reverse the designation."),
    ("Chart of accounts", "The organized list of every account used to record transactions."),
    ("Conditional contribution", "A promise to give that includes a barrier the recipient must overcome and a right of return or release; not recorded as revenue until the barrier is met."),
    ("Contributed nonfinancial assets", "Gifts other than cash or financial assets, such as goods, use of space, and qualifying services. Also called in-kind contributions."),
    ("Contribution", "An unconditional, voluntary, nonreciprocal transfer of assets to an organization."),
    ("Deferred revenue", "Payment received for goods or services not yet delivered; a liability until earned."),
    ("Exchange transaction", "A reciprocal transaction in which each party receives commensurate value."),
    ("FASB", "Financial Accounting Standards Board, which sets U.S. GAAP for private companies and nonprofits."),
    ("Fiduciary duty", "The legal obligation of board members to act with care, loyalty, and obedience to the mission."),
    ("Form 990", "The annual information return filed with the IRS by most tax-exempt organizations; publicly available."),
    ("Functional expenses", "Expenses classified by purpose: program services, management and general, and fundraising."),
    ("GAAP", "Generally accepted accounting principles."),
    ("Indirect costs", "Shared costs not readily identified with a specific project or program. Also called overhead or F&amp;A."),
    ("Joint costs", "Costs of activities that combine fundraising with program or management functions."),
    ("Liquidity", "The ability to meet cash needs for general expenditures over the coming year."),
    ("Net assets", "Total assets minus total liabilities; the nonprofit equivalent of equity."),
    ("Net assets released from restrictions", "The reclassification that occurs when a donor restriction is satisfied."),
    ("Pledge", "A promise to give. If unconditional, it is recorded as revenue and a receivable."),
    ("Public charity", "A 501(c)(3) organization that receives broad public support or has an exempt activity that qualifies it; contrasted with a private foundation."),
    ("Quid pro quo contribution", "A payment that is partly a gift and partly a purchase of goods or services."),
    ("Refundable advance", "Cash received under a conditional agreement before the condition is met; recorded as a liability."),
    ("Single Audit", "A federally required audit of an organization's financial statements and federal award compliance when federal expenditures exceed the threshold."),
    ("Statement of Activities", "The nonprofit income statement, showing revenue, expenses, and change in net assets by restriction class."),
    ("Statement of Financial Position", "The nonprofit balance sheet."),
    ("Uniform Guidance", "Federal rules (2 CFR 200) governing administrative requirements, cost principles, and audits for federal awards."),
    ("UBIT", "Unrelated business income tax: tax on income from a regularly carried-on trade or business not substantially related to the exempt purpose."),
    ("UPMIFA", "Uniform Prudent Management of Institutional Funds Act; state law governing management and spending of endowment funds."),
]
table([["Term", "Definition"]] + [["<b>%s</b>" % a, b] for a, b in gloss], [1.9, 4.9])

# =====================================================================
chapter("", "Put This Handbook to Work",
        "Two ways to turn what you've learned into books you can trust: the right software, "
        "or a bookkeeper who does it for you.", "Get Expert Help")


def promo_card(kicker, name, url_link, pitch, points, cta, accent):
    head_st = ParagraphStyle("pk", parent=S["kicker"], textColor=accent)
    name_st = ParagraphStyle("pn", parent=S["h2"], spaceBefore=0, spaceAfter=4, fontSize=20,
                             leading=24)
    inner = [Paragraph(kicker, head_st), Paragraph(name, name_st),
             Paragraph(pitch, S["boxbody"]), Spacer(1, 2)]
    for pt in points:
        inner.append(Paragraph(pt, ParagraphStyle("pp", parent=S["boxbody"], leftIndent=14,
                                                  bulletIndent=2), bulletText="•"))
    inner.append(Spacer(1, 6))
    btn = Table([[Paragraph(cta, ParagraphStyle("cta", parent=S["cellh"], fontSize=11,
                                                alignment=TA_CENTER))]],
                colWidths=[3.2 * inch])
    btn.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), accent),
                             ("TOPPADDING", (0, 0), (-1, -1), 7),
                             ("BOTTOMPADDING", (0, 0), (-1, -1), 7)]))
    btn.hAlign = "LEFT"
    inner.append(btn)
    t = Table([[inner]], colWidths=[doc.width])
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.8, GRID),
        ("LINEABOVE", (0, 0), (-1, 0), 5, accent),
        ("BACKGROUND", (0, 0), (-1, -1), colors.white),
        ("LEFTPADDING", (0, 0), (-1, -1), 18), ("RIGHTPADDING", (0, 0), (-1, -1), 18),
        ("TOPPADDING", (0, 0), (-1, -1), 14), ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
    ]))
    story.append(KeepTogether([t, Spacer(1, 16)]))


promo_card(
    "DO IT YOURSELF, WITH THE RIGHT TOOL", "MissionLedger", ML_LINK,
    "Nonprofit accounting software from the author of this handbook, built so the practices "
    "in these pages become part of your everyday routine.",
    ["Made for nonprofits, not adapted from small-business software",
     "Supports the habits this guide teaches: tracking restricted funds, "
     "tagging expenses by function, and clear reports for your board",
     "Helps you stay organized for Form 990 season and your auditor"],
    '<a href="%s" color="white">Visit missionledger.fund →</a>' % ML_URL, TEAL)
promo_card(
    "LET A PRO HANDLE IT", "Frontline Bookkeeping", FB_LINK,
    "Done-for-you bookkeeping from the author of this handbook. If you would rather spend your "
    "time on the mission than on reconciliations, hand the books to us.",
    ["Ongoing monthly bookkeeping and reconciliations",
     "Catch-up and cleanup for books that have fallen behind",
     "Clear monthly reports you can hand straight to your board"],
    '<a href="%s" color="white">Visit frontlinebookkeeping.com →</a>' % FB_URL, NAVY)
P("Not sure which fits? Start with MissionLedger if you have someone in-house to keep the books, "
  "or Frontline Bookkeeping if you don't.", "small")

# closing page
story.append(NextPageTemplate("plain"))
story.append(PageBreak())
SP(180)
P("Thank you for reading.", "h1")
P("Good accounting is an act of respect—for your donors, for the people you serve, and for "
  "the staff and volunteers who give their time to your mission. Keep the books clean, keep the "
  "board informed, and keep the mission at the center of every number.", "lede")
SP(10)
P("<b>Next steps</b>", "body")
numbered([
    "Compare your chart of accounts to Chapter 3 and add function and restriction tags.",
    "Build your restricted-funds tracker (Chapter 2) and reconcile it this month.",
    "Adopt the month-end checklist (Chapter 11) and put the compliance calendar on everyone's calendar.",
    "Share the board dashboard (Chapter 12) at your next board meeting.",
    "Want help? Try %s or %s." % (ML_LINK, FB_LINK),
])

doc.multiBuild(story)
print("Wrote", OUT)
