"""Replaces Capacitor's default launcher icon with public/icons/*.png. Run after `cap add android`.
Needs Pillow (pip install pillow). If it is missing the build still works, with the default icon."""
import os, sys
try:
    from PIL import Image
except ImportError:
    print('Pillow not installed: keeping the default Android launcher icon (pip install pillow, then rerun).'); sys.exit(0)
root = os.path.join(os.path.dirname(__file__), '..')
res = os.path.join(root, 'android', 'app', 'src', 'main', 'res')
if not os.path.isdir(res): print('android/ not found; run npm run android:add first'); sys.exit(0)
icon = Image.open(os.path.join(root, 'public', 'icons', 'icon-512.png')).convert('RGBA')
mask = Image.open(os.path.join(root, 'public', 'icons', 'icon-maskable-512.png')).convert('RGBA')
legacy = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
for d, px in legacy.items():
    out = os.path.join(res, f'mipmap-{d}'); os.makedirs(out, exist_ok=True)
    icon.resize((px, px), Image.LANCZOS).save(os.path.join(out, 'ic_launcher.png'))
    icon.resize((px, px), Image.LANCZOS).save(os.path.join(out, 'ic_launcher_round.png'))
    fg = px * 108 // 48
    mask.resize((fg, fg), Image.LANCZOS).save(os.path.join(out, 'ic_launcher_foreground.png'))
print('Android launcher icons written from public/icons/')
