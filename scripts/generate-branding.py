import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

def create_pfp(size=1024):
    img = Image.new("RGBA", (size, size), (8, 18, 14, 255))
    draw = ImageDraw.Draw(img)
    center = size // 2

    # Radial gradient background
    for r in range(size // 2, 0, -2):
        factor = r / (size // 2)
        r_col = int(8 + (18 - 8) * (1 - factor))
        g_col = int(18 + (42 - 18) * (1 - factor))
        b_col = int(14 + (28 - 14) * (1 - factor))
        draw.ellipse(
            [center - r, center - r, center + r, center + r],
            fill=(r_col, g_col, b_col, 255)
        )

    # Ambient glow overlay
    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_radius = int(size * 0.38)
    glow_draw.ellipse(
        [center - glow_radius, center - glow_radius, center + glow_radius, center + glow_radius],
        fill=(46, 123, 84, 90)
    )
    inner_glow_radius = int(size * 0.22)
    glow_draw.ellipse(
        [center - inner_glow_radius, center - inner_glow_radius, center + inner_glow_radius, center + inner_glow_radius],
        fill=(200, 229, 98, 70)
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=55))
    img.alpha_composite(glow)

    # Re-obtain draw handle after composite
    draw = ImageDraw.Draw(img)

    # Concentric security rings
    for radius, width, alpha in [(380, 2, 45), (320, 2, 70), (260, 2, 100)]:
        draw.ellipse(
            [center - radius, center - radius, center + radius, center + radius],
            outline=(200, 229, 98, alpha),
            width=width
        )

    # Radar node markers on outer ring
    for angle in [0, 45, 90, 135, 180, 225, 270, 315]:
        rad = math.radians(angle)
        x = center + int(320 * math.cos(rad))
        y = center + int(320 * math.sin(rad))
        draw.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(200, 229, 98, 140))

    # Hexagonal / Shield core geometry
    # Shomer's signature guardian shield points
    shield_pts = [
        (center, center - 220),       # Top tip
        (center + 180, center - 130), # Top right
        (center + 180, center + 70),  # Mid right
        (center, center + 230),       # Bottom point
        (center - 180, center + 70),  # Mid left
        (center - 180, center - 130), # Top left
    ]

    # Drop shadow on shield
    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    s_draw = ImageDraw.Draw(shadow)
    s_draw.polygon([(x, y + 16) for x, y in shield_pts], fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=25))
    img.alpha_composite(shadow)
    draw = ImageDraw.Draw(img)

    # Shield background fill
    draw.polygon(shield_pts, fill=(20, 42, 30, 255), outline=(200, 229, 98, 255), width=6)

    # Inner concentric shield outline
    inner_shield = [
        (center, center - 190),
        (center + 150, center - 110),
        (center + 150, center + 60),
        (center, center + 195),
        (center - 150, center + 60),
        (center - 150, center - 110),
    ]
    draw.polygon(inner_shield, fill=(26, 56, 40, 255), outline=(46, 123, 84, 200), width=4)

    # Shomer Central Icon: Geometric Lock / Checkmark & Core Diamond
    # Thick verification checkmark integrated with AI core
    check_pts = [
        (center - 85, center + 10),
        (center - 25, center + 75),
        (center + 90, center - 60),
    ]
    draw.line(check_pts, fill=(200, 229, 98, 255), width=28, joint="curve")

    # Core AI pulse node (diamond in upper center)
    diamond_r = 22
    diamond_pts = [
        (center, center - 115 - diamond_r),
        (center + diamond_r, center - 115),
        (center, center - 115 + diamond_r),
        (center - diamond_r, center - 115),
    ]
    draw.polygon(diamond_pts, fill=(217, 236, 128, 255), outline=(255, 255, 255, 220), width=3)

    # Little BOT Chain connection lines to the diamond
    draw.line([(center, center - 85), (center, center - 40)], fill=(200, 229, 98, 160), width=3)

    # Final corner crop to perfect 1024x1024 PNG
    return img


def create_cover(width=1500, height=500):
    img = Image.new("RGBA", (width, height), (7, 16, 12, 255))
    draw = ImageDraw.Draw(img)

    # Base gradient horizontally & vertically
    for x in range(0, width, 5):
        factor = x / width
        # subtle green tint towards center-right
        g_val = int(16 + 22 * math.sin(factor * math.pi))
        draw.rectangle([x, 0, x + 5, height], fill=(7, g_val, 12, 255))

    # Draw cyber matrix grid on right half
    for gy in range(0, height, 40):
        alpha = int(22 + 18 * (gy / height))
        draw.line([(350, gy), (width, gy)], fill=(46, 123, 84, alpha), width=1)
    for gx in range(350, width, 55):
        alpha = int(25 * (gx / width))
        draw.line([(gx, 0), (gx, height)], fill=(46, 123, 84, alpha), width=1)

    # Ambient glow on right
    glow = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    g_draw.ellipse([850, 10, 1450, 480], fill=(46, 123, 84, 85))
    g_draw.ellipse([1020, 90, 1320, 390], fill=(200, 229, 98, 55))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=65))
    img.alpha_composite(glow)
    draw = ImageDraw.Draw(img)

    # Load system font
    font_bold_path = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
    font_reg_path = "/System/Library/Fonts/Supplemental/Arial.ttf"

    font_badge = ImageFont.truetype(font_bold_path, 15)
    font_title = ImageFont.truetype(font_bold_path, 68)
    font_partner = ImageFont.truetype(font_bold_path, 42)
    font_tagline = ImageFont.truetype(font_reg_path, 21)
    font_pill = ImageFont.truetype(font_bold_path, 13)

    # Left-hand avatar safety zone is 0..380. All content is placed nicely starting at x=410
    start_x = 420

    # 1. Top Partnership Pill
    pill_text = "OFFICIAL PARTNER OF BOT CHAIN · CHAIN ID 677"
    pill_w = 460
    pill_h = 32
    pill_y = 65
    draw.rounded_rectangle(
        [start_x, pill_y, start_x + pill_w, pill_y + pill_h],
        radius=16,
        fill=(22, 48, 34, 230),
        outline=(200, 229, 98, 180),
        width=1
    )
    # Green pulse dot inside pill
    draw.ellipse([start_x + 14, pill_y + 11, start_x + 24, pill_y + 21], fill=(200, 229, 98, 255))
    draw.text((start_x + 34, pill_y + 7), pill_text, font=font_badge, fill=(217, 236, 128, 255))

    # 2. Main Title Row: SHOMER [Shield] × BOT CHAIN
    title_y = 125
    draw.text((start_x, title_y), "SHOMER", font=font_title, fill=(255, 255, 255, 255))

    # Shield icon next to SHOMER
    shield_icon_x = start_x + 315
    shield_icon_y = title_y + 12
    draw.polygon([
        (shield_icon_x + 16, shield_icon_y),
        (shield_icon_x + 32, shield_icon_y + 10),
        (shield_icon_x + 32, shield_icon_y + 30),
        (shield_icon_x + 16, shield_icon_y + 44),
        (shield_icon_x, shield_icon_y + 30),
        (shield_icon_x, shield_icon_y + 10),
    ], fill=(46, 123, 84, 255), outline=(200, 229, 98, 255), width=2)
    # Check inside icon
    draw.line([
        (shield_icon_x + 9, shield_icon_y + 22),
        (shield_icon_x + 15, shield_icon_y + 29),
        (shield_icon_x + 24, shield_icon_y + 16),
    ], fill=(200, 229, 98, 255), width=3)

    # Connector "×"
    connector_x = shield_icon_x + 58
    draw.text((connector_x, title_y + 12), "×", font=font_partner, fill=(138, 160, 146, 220))

    # "BOT CHAIN"
    bot_x = connector_x + 48
    draw.text((bot_x, title_y), "BOT CHAIN", font=font_title, fill=(200, 229, 98, 255))

    # 3. Subtitle / Value Proposition
    tag_y = 225
    tag_text = "Automated Deployment Verification & On-Chain Ship Gate Registry"
    draw.text((start_x, tag_y), tag_text, font=font_tagline, fill=(206, 218, 210, 240))

    # 4. Feature Badges Row
    badge_y = 295
    badges = [
        "✓ Immutable Receipts",
        "✓ EIP-1967 Proxies",
        "✓ Bytecode Fingerprints",
        "✓ Zero Vibe Checks",
    ]
    bx = start_x
    for b in badges:
        bw = len(b) * 11 + 24
        draw.rounded_rectangle(
            [bx, badge_y, bx + bw, badge_y + 36],
            radius=6,
            fill=(18, 36, 26, 240),
            outline=(46, 123, 84, 180),
            width=1
        )
        draw.text((bx + 12, badge_y + 9), b, font=font_pill, fill=(225, 235, 228, 255))
        bx += bw + 14

    # 5. Bottom Live Registry Callout Bar
    bar_y = 375
    draw.line([(start_x, bar_y), (width - 60, bar_y)], fill=(46, 123, 84, 120), width=1)

    font_foot_mono = ImageFont.truetype(font_reg_path, 13)
    foot_text = "LIVE CONTRACT: 0xc427474201895710c653105067c543f184c99fa3  ·  SCAN: scan.botchain.ai"
    draw.text((start_x, bar_y + 16), foot_text, font=font_foot_mono, fill=(160, 186, 168, 220))

    return img


def generate_svg_pfp():
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <radialGradient id="bg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#14281d" />
      <stop offset="60%" stop-color="#0c1a14" />
      <stop offset="100%" stop-color="#060e0a" />
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="45%">
      <stop offset="0%" stop-color="#c8e562" stop-opacity="0.35" />
      <stop offset="50%" stop-color="#2e7b54" stop-opacity="0.25" />
      <stop offset="100%" stop-color="#060e0a" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="shieldBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#d9ec80" />
      <stop offset="50%" stop-color="#2e7b54" />
      <stop offset="100%" stop-color="#c8e562" />
    </linearGradient>
    <linearGradient id="shieldFill" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1f4230" />
      <stop offset="100%" stop-color="#13271d" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="24" stdDeviation="32" flood-color="#000000" flood-opacity="0.8" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1024" height="1024" fill="url(#bg)" />
  <circle cx="512" cy="512" r="420" fill="url(#glow)" />

  <!-- Security rings -->
  <circle cx="512" cy="512" r="380" fill="none" stroke="#c8e562" stroke-width="2" stroke-opacity="0.18" />
  <circle cx="512" cy="512" r="320" fill="none" stroke="#c8e562" stroke-width="2" stroke-opacity="0.28" stroke-dasharray="14 10" />
  <circle cx="512" cy="512" r="260" fill="none" stroke="#2e7b54" stroke-width="2" stroke-opacity="0.45" />

  <!-- Orbit nodes -->
  <circle cx="832" cy="512" r="6" fill="#c8e562" opacity="0.8" />
  <circle cx="192" cy="512" r="6" fill="#c8e562" opacity="0.8" />
  <circle cx="512" cy="192" r="6" fill="#c8e562" opacity="0.8" />
  <circle cx="512" cy="832" r="6" fill="#c8e562" opacity="0.8" />
  <circle cx="738" cy="286" r="5" fill="#c8e562" opacity="0.6" />
  <circle cx="286" cy="738" r="5" fill="#c8e562" opacity="0.6" />

  <!-- Guardian Shield -->
  <polygon points="512,292 692,382 692,582 512,742 332,582 332,382"
           fill="url(#shieldFill)"
           stroke="url(#shieldBorder)"
           stroke-width="8"
           filter="url(#shadow)" />

  <!-- Inner faceted shield -->
  <polygon points="512,332 652,402 652,562 512,692 372,562 372,402"
           fill="#163124"
           stroke="#2e7b54"
           stroke-width="3"
           stroke-opacity="0.7" />

  <!-- Core AI Node & Lock -->
  <polygon points="512,376 536,400 512,424 488,400"
           fill="#d9ec80"
           stroke="#ffffff"
           stroke-width="2" />
  <line x1="512" y1="424" x2="512" y2="475" stroke="#c8e562" stroke-width="3" stroke-opacity="0.6" />

  <!-- Bold Verification Checkmark -->
  <path d="M 432 522 L 487 587 L 602 462"
        fill="none"
        stroke="#c8e562"
        stroke-width="32"
        stroke-linecap="round"
        stroke-linejoin="round" />
</svg>"""


def generate_svg_cover():
    return """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 500" width="1500" height="500">
  <defs>
    <linearGradient id="cbg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#08140f" />
      <stop offset="60%" stop-color="#0e1f17" />
      <stop offset="100%" stop-color="#06100c" />
    </linearGradient>
    <radialGradient id="cglow" cx="75%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#c8e562" stop-opacity="0.22" />
      <stop offset="60%" stop-color="#2e7b54" stop-opacity="0.18" />
      <stop offset="100%" stop-color="#06100c" stop-opacity="0" />
    </radialGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M 48 0 L 0 0 0 48" fill="none" stroke="#2e7b54" stroke-width="1" stroke-opacity="0.15" />
    </pattern>
  </defs>

  <!-- Background -->
  <rect width="1500" height="500" fill="url(#cbg)" />
  <rect x="360" width="1140" height="500" fill="url(#grid)" />
  <circle cx="1100" cy="250" r="420" fill="url(#cglow)" />

  <!-- Top Pill -->
  <g transform="translate(420, 60)">
    <rect width="470" height="34" rx="17" fill="#142c1e" stroke="#c8e562" stroke-width="1.2" stroke-opacity="0.7" />
    <circle cx="20" cy="17" r="5" fill="#c8e562" />
    <text x="36" y="23" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#d9ec80" letter-spacing="0.8">OFFICIAL PARTNER OF BOT CHAIN · CHAIN ID 677</text>
  </g>

  <!-- Main Brand Row -->
  <g transform="translate(420, 180)">
    <!-- SHOMER -->
    <text x="0" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="64" font-weight="800" fill="#ffffff" letter-spacing="-1.5">SHOMER</text>

    <!-- Shield Icon -->
    <g transform="translate(310, -52)">
      <polygon points="20,0 40,12 40,36 20,52 0,36 0,12" fill="#244a35" stroke="#c8e562" stroke-width="3" />
      <path d="M 11 26 L 18 34 L 30 18" fill="none" stroke="#c8e562" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" />
    </g>

    <!-- Connector -->
    <text x="375" y="-5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="44" font-weight="600" fill="#698573">×</text>

    <!-- BOT CHAIN -->
    <text x="430" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="64" font-weight="800" fill="#c8e562" letter-spacing="-1.2">BOT CHAIN</text>
  </g>

  <!-- Tagline -->
  <text x="420" y="240" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="22" font-weight="400" fill="#cedad2" letter-spacing="-0.3">
    Automated Deployment Verification &amp; On-Chain Ship Gate Registry
  </text>

  <!-- Badges Row -->
  <g transform="translate(420, 290)">
    <!-- Badge 1 -->
    <g transform="translate(0, 0)">
      <rect width="200" height="36" rx="6" fill="#13271c" stroke="#2e7b54" stroke-width="1.2" />
      <text x="14" y="23" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#e1ebe4">✓ Immutable Receipts</text>
    </g>
    <!-- Badge 2 -->
    <g transform="translate(216, 0)">
      <rect width="180" height="36" rx="6" fill="#13271c" stroke="#2e7b54" stroke-width="1.2" />
      <text x="14" y="23" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#e1ebe4">✓ EIP-1967 Proxies</text>
    </g>
    <!-- Badge 3 -->
    <g transform="translate(412, 0)">
      <rect width="215" height="36" rx="6" fill="#13271c" stroke="#2e7b54" stroke-width="1.2" />
      <text x="14" y="23" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#e1ebe4">✓ Bytecode Fingerprints</text>
    </g>
    <!-- Badge 4 -->
    <g transform="translate(643, 0)">
      <rect width="175" height="36" rx="6" fill="#13271c" stroke="#2e7b54" stroke-width="1.2" />
      <text x="14" y="23" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="#e1ebe4">✓ Zero Vibe Checks</text>
    </g>
  </g>

  <!-- Footer bar -->
  <line x1="420" y1="375" x2="1420" y2="375" stroke="#2e7b54" stroke-width="1" stroke-opacity="0.4" />
  <text x="420" y="405" font-family="'DM Mono', monospace, -apple-system, sans-serif" font-size="13" fill="#9dbba7" letter-spacing="0.5">
    REGISTRY: 0xc427474201895710c653105067c543f184c99fa3   ·   BOTSCAN: scan.botchain.ai
  </text>
</svg>"""


if __name__ == "__main__":
    print("Generating PFP and Cover images...")

    # Generate PNGs
    pfp_img = create_pfp(1024)
    pfp_img.save("public/shomer-x-pfp.png", "PNG")
    print("✓ Saved public/shomer-x-pfp.png (1024x1024)")

    cover_img = create_cover(1500, 500)
    cover_img.save("public/shomer-x-cover.png", "PNG")
    print("✓ Saved public/shomer-x-cover.png (1500x500)")

    # Generate SVGs
    with open("public/shomer-x-pfp.svg", "w") as f:
        f.write(generate_svg_pfp())
    print("✓ Saved public/shomer-x-pfp.svg")

    with open("public/shomer-x-cover.svg", "w") as f:
        f.write(generate_svg_cover())
    print("✓ Saved public/shomer-x-cover.svg")

    print("\nAll X branding assets created successfully in public/!")
