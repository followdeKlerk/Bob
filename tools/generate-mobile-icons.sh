#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source=apps/mobile/assets/bob-logo.png
res=apps/mobile/android/app/src/main/res
# Cropped transparent wordmark for in-app overlays; never place the black icon
# canvas over scrolling content.
magick "$source" -colorspace gray -threshold 35% -alpha off \
  \( +clone -fill white -colorize 100 \) +swap -compose CopyOpacity -composite \
  -trim +repage -resize 304x144 PNG32:apps/mobile/assets/bob-wordmark.png
for spec in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  density=${spec%:*}; size=${spec#*:}
  mkdir -p "$res/mipmap-$density" "$res/drawable-$density"
  magick "$source" -resize "${size}x${size}" -background black -alpha remove "$res/mipmap-$density/ic_launcher.png"
  cp "$res/mipmap-$density/ic_launcher.png" "$res/mipmap-$density/ic_launcher_round.png"
  # Status-bar icons need a transparent monochrome silhouette, not a black square.
  # Use the B from the supplied wordmark so it stays legible at 24dp.
  stat=$((size/2))
  magick "$source" -crop 345x475+118+375 +repage -colorspace gray -threshold 35% \
    -alpha copy -fill white -colorize 100 -resize "$((stat-4))x$((stat-4))" \
    -gravity center -background none -extent "${stat}x${stat}" "$res/drawable-$density/ic_stat_bob.png"
done
mkdir -p "$res/drawable-nodpi" "$res/mipmap-anydpi-v26" "$res/mipmap-anydpi-v33"
magick "$source" -resize 192x192 "$res/drawable-nodpi/bob_notification_logo.png"
# 108dp adaptive foreground; the wordmark stays inside the 66dp safe zone.
magick "$source" -colorspace gray -threshold 35% -alpha copy -fill white -colorize 100 \
  -resize 288x288 -gravity center -background none -extent 432x432 "$res/drawable-nodpi/bob_launcher_foreground.png"
for name in ic_launcher ic_launcher_round; do
cat > "$res/mipmap-anydpi-v26/$name.xml" <<'XML'
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@android:color/black" />
    <foreground android:drawable="@drawable/bob_launcher_foreground" />
</adaptive-icon>
XML
cat > "$res/mipmap-anydpi-v33/$name.xml" <<'XML'
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@android:color/black" />
    <foreground android:drawable="@drawable/bob_launcher_foreground" />
    <monochrome android:drawable="@drawable/bob_launcher_foreground" />
</adaptive-icon>
XML
done
