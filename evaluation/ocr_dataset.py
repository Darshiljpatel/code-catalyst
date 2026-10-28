"""Generator for the OCR benchmark images (Improvement 2).

Writes 20 original, synthetic ad graphics for the fictional LumaDesk brand to
evaluation/fixtures/ocr/, plus ground_truth.json with the exact text of every line and the
box it was drawn in (normalised 0..1, from the font's ink bounding box). The graphics are
drawn here from fonts that ship with Linux distributions; they are not photographs or
real advertisements. Varied fonts, sizes, colours and backgrounds, including deliberately
low-contrast lines, small print, and claims with correct and wrong prices, trial lengths,
discounts and brand spellings.

The committed images are the dataset; regenerating needs the same fonts and Pillow version
and will normally change the frozen SHA in evaluation/ocr_benchmark.py.
Usage: python -m evaluation.ocr_dataset
"""
import json
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT = Path(__file__).resolve().parent / 'fixtures' / 'ocr'
FONTS = {
    'dejavu-sans-bold': '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    'dejavu-sans': '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    'dejavu-serif-bold': '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
    'dejavu-mono': '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    'liberation-sans': '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    'liberation-sans-bold': '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    'liberation-sans-italic': '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf',
    'liberation-narrow-bold': '/usr/share/fonts/truetype/liberation/LiberationSansNarrow-Bold.ttf',
    'liberation-serif': '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
    'liberation-serif-bold': '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
    'ubuntu-bold': '/usr/share/fonts/truetype/ubuntu/Ubuntu-B.ttf',
    'ubuntu-light': '/usr/share/fonts/truetype/ubuntu/Ubuntu-L.ttf',
    'noto-sans': '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    'noto-serif-bold': '/usr/share/fonts/truetype/noto/NotoSerif-Bold.ttf',
    'nimbus-sans-bold': '/usr/share/fonts/opentype/urw-base35/NimbusSans-Bold.otf',
    'urw-gothic': '/usr/share/fonts/opentype/urw-base35/URWGothic-Demi.otf',
}

# Each ad: size, background, lines (text, font, px, colour) drawn top to bottom from `top`,
# optional button behind one line, and tags describing what makes it hard.
ADS = [
    dict(id='ad-01', size=(1200, 628), bg=('solid', '#ffffff'), tags=['clean'], lines=[
        ('LumaDesk', 'dejavu-sans-bold', 72, '#111111'), ('Start your 14-day free trial', 'dejavu-sans', 44, '#111111'),
        ('Team plans from $12 per seat', 'dejavu-sans', 36, '#333333')]),
    dict(id='ad-02', size=(1080, 1080), bg=('solid', '#14213d'), tags=['dark_background'], lines=[
        ('Book desks in seconds', 'liberation-sans-bold', 70, '#ffffff'), ('Save 15% with annual plans', 'liberation-sans', 48, '#fca311'),
        ('lumadesk.com', 'liberation-sans', 34, '#e5e5e5')]),
    dict(id='ad-03', size=(1200, 628), bg=('gradient', '#ff7a18', '#d6246e', 'horizontal'), tags=['gradient', 'wrong_claim'], lines=[
        ('Try LumaDesk free for 30 days', 'nimbus-sans-bold', 60, '#ffffff'), ('No card needed', 'nimbus-sans-bold', 40, '#ffffff')]),
    dict(id='ad-04', size=(1080, 1080), bg=('solid', '#ffffff'), tags=['low_contrast', 'forbidden_variant'], lines=[
        ('Luma Desk for hybrid teams', 'liberation-sans-bold', 60, '#d0d0d0'), ('$12 per seat per month', 'liberation-sans', 44, '#c8c8c8')]),
    dict(id='ad-05', size=(1200, 628), bg=('blobs', '#2a4d69', 5), tags=['photo_like'], lines=[
        ('Your office, organised', 'ubuntu-bold', 64, '#ffffff'), ('Free 14-day trial', 'ubuntu-bold', 44, '#ffe066')]),
    dict(id='ad-06', size=(1080, 1080), bg=('solid', '#f3e9dc'), tags=['small_print'], lines=[
        ('Hot desking made simple', 'dejavu-sans-bold', 60, '#3d2c1e'), ('LumaDesk shows who sits where.', 'dejavu-sans', 36, '#3d2c1e'),
        ('Prices exclude VAT. Annual plans save 15%.', 'dejavu-sans', 16, '#5a4636')]),
    dict(id='ad-07', size=(1200, 628), bg=('solid', '#fffaf0'), tags=['serif', 'wrong_claim'], lines=[
        ('The calm way to share desks', 'liberation-serif', 58, '#222222'), ('Only $10 per seat', 'liberation-serif-bold', 50, '#8b0000')]),
    dict(id='ad-08', size=(1080, 1080), bg=('solid', '#0b3d2e'), tags=['monospace', 'all_caps', 'wrong_claim'], lines=[
        ('LUMADESK', 'dejavu-mono', 90, '#b5f44a'), ('SAVE 20% TODAY', 'dejavu-mono', 60, '#b5f44a')]),
    dict(id='ad-09', size=(1200, 628), bg=('solid', '#dbeafe'), tags=['italic'], lines=[
        ('Meet LumaDesk Rooms', 'liberation-sans-italic', 66, '#1e3a8a'), ('Start a 14-day trial', 'liberation-sans-italic', 46, '#1e3a8a')]),
    dict(id='ad-10', size=(1080, 1080), bg=('solid', '#c1121f'), tags=['condensed'], lines=[
        ('FLASH SALE', 'liberation-narrow-bold', 110, '#ffffff'), ('Save 15% on annual plans', 'liberation-narrow-bold', 56, '#ffffff'),
        ('Ends Friday', 'liberation-narrow-bold', 40, '#fdf0d5')]),
    dict(id='ad-11', size=(1200, 628), bg=('solid', '#222222'), tags=['low_contrast', 'dark_background'], lines=[
        ('Night shift? LumaDesk never sleeps', 'dejavu-sans-bold', 50, '#4a4a4a'), ('Plans from $12 per seat', 'dejavu-sans', 40, '#505050')]),
    dict(id='ad-12', size=(1080, 1080), bg=('solid', '#ffffff'), tags=['button', 'small_print'],
         button=dict(line=1, fill='#ff6b35', pad=(36, 22)), lines=[
        ('Desks when you need them', 'noto-serif-bold', 58, '#14213d'), ('Start free trial', 'noto-sans', 46, '#ffffff'),
        ('14 days free, cancel anytime', 'noto-sans', 24, '#8a8a8a')]),
    dict(id='ad-13', size=(1200, 628), bg=('stripes', '#f1f5f9', '#dbe4ee', 24), tags=['pattern'], lines=[
        ('Desk booking for 500+ teams', 'liberation-sans-bold', 58, '#0f172a'), ('LumaDesk', 'liberation-sans-bold', 46, '#0f172a')]),
    dict(id='ad-14', size=(1080, 1080), bg=('noise', '#6b7280', 40), tags=['noisy_background', 'jpeg', 'wrong_claim'], fmt='jpeg', lines=[
        ('Try it free for 14 days', 'dejavu-sans-bold', 64, '#ffffff'), ('Then $15 per seat', 'dejavu-sans-bold', 52, '#ffffff')]),
    dict(id='ad-15', size=(1200, 628), bg=('gradient', '#3c096c', '#7b2cbf', 'vertical'), tags=['gradient', 'light_weight'], lines=[
        ('Hybrid work, sorted', 'ubuntu-light', 70, '#ffd60a'), ('Save 15% yearly with LumaDesk', 'ubuntu-light', 44, '#ffd60a')]),
    dict(id='ad-16', size=(720, 1280), bg=('blobs', '#1b263b', 7), tags=['photo_like', 'portrait', 'wrong_claim'], lines=[
        ('New: LumaDesk Maps', 'dejavu-sans-bold', 52, '#ffffff'), ('Find a free desk fast', 'dejavu-sans', 40, '#ffffff'),
        ('Start your 30-day trial', 'dejavu-sans-bold', 40, '#90e0ef')]),
    dict(id='ad-17', size=(1080, 1080), bg=('solid', '#ffffff'), tags=['very_low_contrast'], lines=[
        ('Limited offer', 'urw-gothic', 64, '#fff3a0'), ('Save 15% with annual billing', 'urw-gothic', 48, '#111111')]),
    dict(id='ad-18', size=(1200, 628), bg=('solid', '#0f766e'), tags=['case_variant'], lines=[
        ('Lumadesk for teams', 'noto-sans', 64, '#ffffff'), ('$12 per seat, billed monthly', 'noto-sans', 44, '#ccfbf1')]),
    dict(id='ad-19', size=(1080, 1080), bg=('solid', '#fefae0'), tags=['mixed_sizes', 'small_print'], lines=[
        ('15%', 'dejavu-sans-bold', 200, '#bc6c25'), ('off annual plans', 'dejavu-sans', 48, '#283618'),
        ('LumaDesk. Terms apply.', 'dejavu-sans', 18, '#606c38')]),
    dict(id='ad-20', size=(1200, 628), bg=('gradient', '#0b0b0b', '#e0e0e0', 'horizontal'), tags=['text_across_gradient'], lines=[
        ('Two weeks free', 'dejavu-serif-bold', 72, '#7f7f7f'), ('then $12 per seat', 'dejavu-serif-bold', 48, '#9a9a9a')]),
]


def rgb(hex_colour):
    hex_colour = hex_colour.lstrip('#')
    return tuple(int(hex_colour[i:i + 2], 16) for i in (0, 2, 4))


def background(spec, size, rng):
    kind = spec[0]
    width, height = size
    if kind == 'solid':
        return Image.new('RGB', size, rgb(spec[1]))
    if kind == 'gradient':
        a, b, direction = rgb(spec[1]), rgb(spec[2]), spec[3]
        image = Image.new('RGB', size)
        draw = ImageDraw.Draw(image)
        steps = width if direction == 'horizontal' else height
        for i in range(steps):
            t = i / max(1, steps - 1)
            colour = tuple(round(a[k] + (b[k] - a[k]) * t) for k in range(3))
            draw.line([(i, 0), (i, height)] if direction == 'horizontal' else [(0, i), (width, i)], fill=colour)
        return image
    if kind == 'stripes':
        image = Image.new('RGB', size, rgb(spec[1]))
        draw = ImageDraw.Draw(image)
        for x in range(-height, width, spec[3] * 2):
            draw.polygon([(x, 0), (x + spec[3], 0), (x + spec[3] + height, height), (x + height, height)], fill=rgb(spec[2]))
        return image
    if kind == 'noise':
        base, spread = rgb(spec[1]), spec[2]
        image = Image.new('RGB', size)
        image.putdata([tuple(max(0, min(255, c + rng.randint(-spread, spread))) for c in base) for _ in range(width * height)])
        return image
    if kind == 'blobs':
        image = Image.new('RGB', size, rgb(spec[1]))
        draw = ImageDraw.Draw(image)
        for _ in range(spec[2]):
            r = rng.randint(min(size) // 6, min(size) // 2)
            x, y = rng.randint(0, width), rng.randint(0, height)
            colour = tuple(rng.randint(40, 200) for _ in range(3))
            draw.ellipse([x - r, y - r, x + r, y + r], fill=colour)
        return image.filter(ImageFilter.GaussianBlur(radius=min(size) // 12))
    raise ValueError(kind)


def mean_colour(image, box):
    crop = image.crop(box).resize((8, 8))
    pixels = list(crop.getdata())
    return tuple(round(sum(p[k] for p in pixels) / len(pixels)) for k in range(3))


def luminance(colour):
    def linear(c):
        c = c / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (linear(c) for c in colour)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a, b):
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def render(ad):
    rng = random.Random(ad['id'])
    width, height = ad['size']
    image = background(ad['bg'], ad['size'], rng)
    draw = ImageDraw.Draw(image)
    margin = round(width * 0.08)
    total = sum(round(px * 1.5) for _, _, px, _ in ad['lines'])
    y = max(margin, (height - total) // 2)
    lines = []
    for index, (text, font_name, px, colour) in enumerate(ad['lines']):
        font = ImageFont.truetype(FONTS[font_name], px)
        left, top, right, bottom = draw.textbbox((margin, y), text, font=font)
        button = ad.get('button')
        if button and button['line'] == index:
            pad_x, pad_y = button['pad']
            draw.rounded_rectangle([left - pad_x, top - pad_y, right + pad_x, bottom + pad_y], radius=pad_y, fill=rgb(button['fill']))
        behind = mean_colour(image, (left, top, right, bottom))
        draw.text((margin, y), text, font=font, fill=rgb(colour))
        lines.append(dict(text=text, font=font_name, size_px=px, colour=colour, background=f'#{bytes(behind).hex()}',
                          contrast=round(contrast(rgb(colour), behind), 2),
                          box=dict(x=round(left / width, 5), y=round(top / height, 5),
                                   w=round((right - left) / width, 5), h=round((bottom - top) / height, 5))))
        y += round(px * 1.5) + (round(button['pad'][1] * 2) if button and button['line'] == index else 0)
    return image, lines


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    truth = dict(synthetic=True, brand='LumaDesk (fictional)', generator='evaluation/ocr_dataset.py',
                 note='Original synthetic ad graphics drawn by the generator; not real advertisements or photographs.',
                 images=[])
    for ad in ADS:
        image, lines = render(ad)
        if ad.get('fmt') == 'jpeg':
            name = f"{ad['id']}.jpg"
            image.save(OUT / name, quality=85)
        else:
            name = f"{ad['id']}.png"
            image.save(OUT / name, optimize=False)
        truth['images'].append(dict(id=ad['id'], file=name, width=ad['size'][0], height=ad['size'][1], tags=ad['tags'],
                                    text='\n'.join(line['text'] for line in lines), lines=lines))
    (OUT / 'ground_truth.json').write_text(json.dumps(truth, indent=2) + '\n')
    print(f"Wrote {len(ADS)} images and ground_truth.json to {OUT}")


if __name__ == '__main__':
    main()
