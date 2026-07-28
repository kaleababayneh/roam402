# Landing asset generators

`public/images/dashboard.png` is NOT generated from a mock anymore: it is a
real screenshot of https://agents-trust.com (1920x1080 viewport, 2x scale,
downsampled to 1920) so the hero shows live census data. Recapture it the
same way when the observatory changes. `dashboard-mock.html` is kept only as
a reference for the old mocked console.

Source mocks for the raster assets in `public/` (the landing itself is
`src/routes/landing.ts`). Regenerate after editing a mock (numbers in the
dashboard/banner are illustrative):

```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$CHROME" --headless --disable-gpu --hide-scrollbars --timeout=15000 \
  --user-data-dir=/tmp/r402-shots --force-device-scale-factor=2 \
  --window-size=1920,1080 --screenshot=/tmp/dashboard-2x.png dashboard-mock.html
sips --resampleWidth 1920 /tmp/dashboard-2x.png --out ../../public/images/dashboard.png

# banner-mock.html  → --window-size=1200,630 → sips 1200 → public/icons/banner.png
# icon-mock.html    → --window-size=512,512 --default-background-color=00000000
#                     → public/icons/icon.png (and favicon.ico via a PNG-in-ICO wrap)
```

The mocks reference `public/icons/roam402.svg` by absolute file path; adjust
the `<img src>` if the repo lives elsewhere. If the raw Chrome CLI hangs,
drive the same capture through puppeteer-core with `executablePath` pointed
at the installed Chrome.
