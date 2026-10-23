#!/usr/bin/env bash
# Derives the inputs @capacitor/assets reads from the PWA's own icons, so the launcher
# icon and the installed PWA are the same picture. Run from anywhere; the outputs are
# committed beside this file, then `npx capacitor-assets generate` (see the README)
# turns them into the Android resources.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
icons="$here/../public/icons"

# The icon's own orange, read off the maskable icon's corner.
orange='#ffb454'
# The Night ground, which is also the manifest's background_color.
ground='#0a0c14'

# A full bleed square: Android's legacy launcher icons and the round variant.
magick "$icons/icon-maskable-512.png" -filter Lanczos -resize 1024x1024 "$here/icon-only.png"

# The adaptive icon's two layers. The maskable icon keeps the boat inside the safe
# zone already, so its orange becomes the background layer and the rest the foreground.
magick "$icons/icon-maskable-512.png" -filter Lanczos -resize 1024x1024 \
  -fuzz 8% -transparent "$orange" "$here/icon-foreground.png"
magick -size 1024x1024 "xc:$orange" "$here/icon-background.png"

# The splash: the rounded icon on the Night ground, in both system themes, because
# the app opens in Night until the stored preference is read.
magick -size 2732x2732 "xc:$ground" \
  \( "$icons/icon-512.png" -filter Lanczos -resize 640x640 \) \
  -gravity center -composite "$here/splash.png"
cp "$here/splash.png" "$here/splash-dark.png"
