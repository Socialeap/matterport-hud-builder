#!/usr/bin/env node
// Generate production PWA icons from the 512×512 brand mark
// (public/favicon.png) using sharp. Reproducible — re-run after a brand
// refresh. Outputs to public/icons/.
//
//   "any" icons (192, 512): the brand mark resized, alpha preserved.
//   maskable 512: brand mark scaled into the ~80% maskable safe zone
//     (logo ≈ 70% width) and flattened onto the brand background so the
//     OS circular/squircle mask never clips the mark.
//   apple-touch 180: flattened onto the opaque brand background (iOS does
//     not honor transparency and would otherwise composite on black).
//
// Run: node scripts/generate-pwa-icons.mjs

import sharp from "sharp";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "public", "favicon.png");
const OUT = path.join(root, "public", "icons");

// Brand background (matches theme_color / atlas-shell) for flattened icons.
const BRAND_BG = { r: 2, g: 6, b: 23, alpha: 1 }; // #020617

async function anyIcon(size, file) {
  await sharp(SRC)
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(OUT, file));
}

async function flattenedIcon(size, logoRatio, file) {
  const logoPx = Math.round(size * logoRatio);
  const pad = Math.round((size - logoPx) / 2);
  const logo = await sharp(SRC).resize(logoPx, logoPx, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: BRAND_BG } })
    .composite([{ input: logo, top: pad, left: pad }])
    .png()
    .toFile(path.join(OUT, file));
}

async function main() {
  await anyIcon(192, "icon-192.png");
  await anyIcon(512, "icon-512.png");
  // Maskable: logo at 70% inside the 80% safe zone, flattened on brand bg.
  await flattenedIcon(512, 0.7, "icon-maskable-512.png");
  // Apple touch: opaque brand bg, slight breathing room (logo ~82%).
  await flattenedIcon(180, 0.82, "apple-touch-icon-180.png");
  console.log("PWA icons generated in public/icons/");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
