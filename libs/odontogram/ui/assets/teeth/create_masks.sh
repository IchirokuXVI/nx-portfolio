#!/bin/bash
for f in *_{root,crown}.png; do
  base="${f%.*}"                  # strip extension
  prefix="${base%%_*}"            # number or prefix before first underscore
  part="${base##*_}"              # root or crown

  magick "$f" \
    -alpha off \
    -colorspace Gray \
    -threshold 60% \
    -fill gray -draw "color 0,0 floodfill" \
    -fill none -opaque gray \
    -morphology Erode Diamond:1 \
    "${prefix}_${part}_mask.png"

done

