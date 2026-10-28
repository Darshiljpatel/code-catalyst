"""Regenerate apps/web/public/samples/lumadesk-social-ad.png, the fictional ad behind "Try the sample ad".

It carries an all-caps LUMADESK headline (Improvement 3 story) and a 30-day trial claim that
contradicts the 14-day guideline (Improvement 2 story).
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parents[1] / 'apps/web/public/samples/lumadesk-social-ad.png'


def font(size):
    for path in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default(size)


def main():
    width = height = 1080
    image = Image.new('RGB', (width, height), (22, 32, 64))
    draw = ImageDraw.Draw(image)
    draw.rectangle([0, 0, width, 140], fill=(255, 137, 94))
    draw.text((60, 40), 'LUMADESK', font=font(64), fill=(22, 32, 64))
    draw.text((60, 300), 'Your desk, sorted.', font=font(72), fill=(255, 255, 255))
    draw.text((60, 470), 'Start your 30-day free trial', font=font(52), fill=(230, 196, 119))
    draw.text((60, 560), 'The fastest desk booking app ever made.', font=font(36), fill=(220, 225, 235))
    draw.rounded_rectangle([60, 820, 520, 930], radius=20, fill=(180, 213, 160))
    draw.text((100, 850), 'Try LumaDesk', font=font(44), fill=(22, 32, 64))
    draw.text((60, 1010), 'Fictional brand for BrandGuard demos.', font=font(22), fill=(150, 160, 180))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, optimize=True)


if __name__ == '__main__':
    main()
