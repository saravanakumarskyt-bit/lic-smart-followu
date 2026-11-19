#!/usr/bin/env python3
"""Generate SYNTHETIC test PDFs (no real customer data) into tests/fixtures/.

All names are invented, policy numbers are fake 9-digit numbers starting 99, and mobile numbers are the
obviously fake 9000000xxx range.  Requires reportlab (+ Pillow and the tesseract-free scanned variant).
"""
import os
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures')
os.makedirs(OUT, exist_ok=True)

# name, policy, premium, due (dd-mm-yyyy), mobile, status
BASE = [
    ('RAMESH KUMAR',     '990000011', '12,500', '18-11-2026', '9000000001', 'In Force'),
    ('LAKSHMI SUNDARAM', '990000022', '5,000',  '19-11-2026', '9000000002', 'In Force'),
    ('MOHAMED ISMAIL',   '990000033', '24,750', '21-11-2026', '9000000003', 'In Force'),
    ('PRIYA NATARAJAN',  '990000044', '3,200',  '25-11-2026', '9000000004', 'Lapsed'),
    ('SENTHIL VELAN',    '990000055', '8,400',  '10-11-2026', '',           'In Force'),
    ('KAVITHA RAJAN',    '990000066', '15,000', '30-11-2026', '9000000006', 'In Force'),
    ('RAMESH KUMAR',     '990000077', '6,100',  '05-12-2026', '9000000001', 'In Force'),
    ('ARUN PRAKASH',     '990000088', '45,000', '31-02-2026', '9000000008', 'In Force'),   # invalid date
]


def layout_a(path):
    """Standard table: S.No | Policy No | Name | Plan | Term | Mode | DOC | Due Date | Premium | Mobile | Status."""
    c = canvas.Canvas(path, pagesize=landscape(A4))
    W, H = landscape(A4)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(30, H - 30, 'LIC OF INDIA - PREMIUM DUE LIST (SAMPLE)')
    c.setFont('Helvetica', 8)
    c.drawString(30, H - 44, 'Advisor Code: SAMPLE   Branch: SAMPLE   Printed: 01/11/2026')
    cols = [30, 62, 130, 250, 300, 345, 400, 470, 540, 610, 700]
    heads = ['S.No', 'Policy No', 'Name of Policyholder', 'Plan', 'Term', 'Mode', 'DOC', 'Due Date', 'Premium', 'Mobile', 'Status']
    y = H - 70
    c.setFont('Helvetica-Bold', 8)
    for x, h in zip(cols, heads):
        c.drawString(x, y, h)
    c.setFont('Helvetica', 8)
    for i, (n, pol, prem, due, mob, st) in enumerate(BASE, 1):
        y -= 16
        row = [str(i), pol, n, '914', '20', 'Yly', '15-03-2015', due, prem, mob, st]
        for x, v in zip(cols, row):
            c.drawString(x, y, v)
    y -= 16
    c.drawString(30, y, 'Total records: %d' % len(BASE))
    c.showPage()
    c.save()


def layout_b(path):
    """Different column order, two-line headers, wrapped long name, 2 pages with the header repeated."""
    c = canvas.Canvas(path, pagesize=A4)
    W, H = A4
    cols = [30, 150, 215, 290, 360, 430]
    for page in range(2):
        c.setFont('Helvetica-Bold', 10)
        c.drawString(30, H - 30, 'Policy Premium Due Report - Page %d' % (page + 1))
        y = H - 60
        c.setFont('Helvetica-Bold', 8)
        c.drawString(cols[0], y, 'Policy Holder'); c.drawString(cols[1], y, 'Policy')
        c.drawString(cols[2], y, 'Next'); c.drawString(cols[3], y, 'Instalment'); c.drawString(cols[4], y, 'Contact'); c.drawString(cols[5], y, 'Policy')
        y -= 10
        c.drawString(cols[0], y, 'Name'); c.drawString(cols[1], y, 'Number')
        c.drawString(cols[2], y, 'Due Date'); c.drawString(cols[3], y, 'Premium'); c.drawString(cols[4], y, 'Number'); c.drawString(cols[5], y, 'Status')
        c.setFont('Helvetica', 8)
        rows = [
            ('Gopalakrishnan Venkataraman', '990001011', '12/12/2026', 'Rs. 18,000/-', '9000000011', 'In Force'),
            ('Meena Devi', '990001022', '14/12/2026', 'Rs. 2,450.50', '9000000012', 'In Force'),
            ('Anand Raj', '990001033', '16/12/2026', 'Rs. 7,000', '', 'Paid-up'),
        ] if page == 0 else [
            ('Selvi Murugan', '990001044', '20/12/2026', 'Rs. 9,999', '9000000014', 'In Force'),
            ('Karthik Subramanian', '990001055', '22/12/2026', 'Rs. 1,25,000', '9000000015', 'In Force'),
        ]
        for n, pol, due, prem, mob, st in rows:
            y -= 18
            if len(n) > 18:  # wrap into two lines
                a, b = n.split(' ', 1)
                c.drawString(cols[0], y, a)
                c.drawString(cols[1], y, pol); c.drawString(cols[2], y, due); c.drawString(cols[3], y, prem); c.drawString(cols[4], y, mob); c.drawString(cols[5], y, st)
                y -= 9
                c.drawString(cols[0], y, b)
            else:
                c.drawString(cols[0], y, n)
                c.drawString(cols[1], y, pol); c.drawString(cols[2], y, due); c.drawString(cols[3], y, prem); c.drawString(cols[4], y, mob); c.drawString(cols[5], y, st)
        c.showPage()
    c.save()


def layout_c(path):
    """No header, no columns: one text line per policy, dates written with month names."""
    c = canvas.Canvas(path, pagesize=A4)
    W, H = A4
    c.setFont('Helvetica', 9)
    c.drawString(30, H - 30, 'Follow-up list')
    lines = [
        '1. 990002011 SUMATHI BALAN  due 15 Dec 2026  Rs.4,500/-  Mobile 90000 00021',
        '2. 990002022 VIJAY ANAND  due 17-Dec-2026  Rs.11,250  Mob: +91 9000000022',
        '3. 990002033 DEEPA RAMAN  due 18/12/2026  Rs.6,000/-',
    ]
    y = H - 60
    for ln in lines:
        c.drawString(30, y, ln)
        y -= 16
    c.save()


def layout_d_scanned(path):
    """Image-only PDF: the table is drawn as pixels, so there is NO text layer (needs OCR)."""
    img = Image.new('RGB', (1654, 700), 'white')
    d = ImageDraw.Draw(img)
    font = None
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf']:
        if os.path.exists(p):
            font = ImageFont.truetype(p, 34)
            break
    font = font or ImageFont.load_default()
    xs = [40, 320, 780, 1060, 1300]
    heads = ['Policy No', 'Name', 'Due Date', 'Premium', 'Mobile']
    y = 40
    for x, h in zip(xs, heads):
        d.text((x, y), h, fill='black', font=font)
    rows = [
        ('990003011', 'ASHA MENON', '20-12-2026', '5,500', '9000000031'),
        ('990003022', 'BALAJI IYER', '22-12-2026', '13,800', '9000000032'),
        ('990003033', 'CHITRA DEVI', '24-12-2026', '2,750', '9000000033'),
    ]
    for r in rows:
        y += 70
        for x, v in zip(xs, r):
            d.text((x, y), v, fill='black', font=font)
    png = os.path.join(OUT, 'sample-d-scanned.png')
    img.save(png)
    c = canvas.Canvas(path, pagesize=(1654 * 0.36, 700 * 0.36))
    c.drawImage(ImageReader(png), 0, 0, width=1654 * 0.36, height=700 * 0.36)
    c.showPage()
    c.save()


def layout_dupes(path):
    """Repeats a policy+due date from layout A (duplicate) and adds a new installment for the same policy."""
    c = canvas.Canvas(path, pagesize=A4)
    W, H = A4
    cols = [30, 130, 300, 380, 460]
    heads = ['Policy No', 'Name', 'Due Date', 'Premium', 'Mobile']
    y = H - 50
    c.setFont('Helvetica-Bold', 9)
    for x, h in zip(cols, heads):
        c.drawString(x, y, h)
    c.setFont('Helvetica', 9)
    rows = [
        ('990000011', 'RAMESH KUMAR', '18-11-2026', '12,500', '9000000001'),  # exact duplicate of layout A
        ('990000011', 'RAMESH KUMAR', '18-11-2027', '12,500', '9000000001'),  # next installment: allowed
    ]
    for r in rows:
        y -= 16
        for x, v in zip(cols, r):
            c.drawString(x, y, v)
    c.save()


def layout_f_large(path):
    """600 synthetic rows over 12 pages, header repeated on every page (tests large-file handling)."""
    c = canvas.Canvas(path, pagesize=A4)
    W, H = A4
    cols = [30, 120, 300, 380, 470]
    heads = ['Policy No', 'Name of Policyholder', 'Due Date', 'Premium', 'Mobile']
    n = 0
    for page in range(12):
        y = H - 40
        c.setFont('Helvetica-Bold', 8)
        for x, h in zip(cols, heads):
            c.drawString(x, y, h)
        c.setFont('Helvetica', 8)
        for _ in range(50):
            n += 1
            y -= 14
            day = 1 + (n % 28)
            row = ['9900%05d' % n, 'CUSTOMER NUMBER %d' % n, '%02d-12-2026' % day, '%d,%03d' % (1 + n % 20, n % 1000), '9000%06d' % n]
            for x, v in zip(cols, row):
                c.drawString(x, y, v)
        c.showPage()
    c.save()


def layout_g_password(path):
    """Same as layout C data but encrypted with the password 'test1234'."""
    from pypdf import PdfReader, PdfWriter
    tmp = path + '.tmp'
    layout_a(tmp)
    r = PdfReader(tmp)
    w = PdfWriter()
    for p in r.pages:
        w.add_page(p)
    w.encrypt('test1234')
    with open(path, 'wb') as f:
        w.write(f)
    os.remove(tmp)


if __name__ == '__main__':
    layout_a(os.path.join(OUT, 'sample-a-standard.pdf'))
    layout_b(os.path.join(OUT, 'sample-b-twoline-headers.pdf'))
    layout_c(os.path.join(OUT, 'sample-c-no-header.pdf'))
    layout_d_scanned(os.path.join(OUT, 'sample-d-scanned.pdf'))
    layout_dupes(os.path.join(OUT, 'sample-e-duplicates.pdf'))
    layout_f_large(os.path.join(OUT, 'sample-f-large.pdf'))
    layout_g_password(os.path.join(OUT, 'sample-g-password.pdf'))
    print('wrote fixtures to', os.path.abspath(OUT))
