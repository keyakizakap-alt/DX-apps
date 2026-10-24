// Renders assets/brand/icon.svg into every icon the app ships (run after editing the SVG):
//   node scripts/gen-icons.mjs
// Uses the Chromium that Playwright already needs for E2E (no image library dependency).
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync('assets/brand/icon.svg', 'utf8');
const markOnly = svg.replace(/<g id="background">[\s\S]*?<\/g>/, '');
// Android adaptive icons crop to a 66/108 safe circle: shrink the mark around the centre.
const scaled = (s, k) => s.replace('<g id="mark">', `<g id="mark" transform="translate(512 512) scale(${k}) translate(-512 -512)">`);
// Monochrome (Android themed icons): one colour, details as cut-outs.
const mono = scaled(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
    <mask id="m"><rect width="1024" height="1024" fill="#000"/>
      <rect x="212" y="352" width="600" height="360" rx="44" fill="#fff"/>
      <circle cx="340" cy="482" r="58" fill="#000"/>
      <rect x="432" y="442" width="260" height="30" rx="15" fill="#000"/>
      <rect x="432" y="496" width="190" height="22" rx="11" fill="#000"/>
      <rect x="270" y="594" width="300" height="20" rx="10" fill="#000"/>
      <rect x="270" y="636" width="220" height="20" rx="10" fill="#000"/>
      <circle cx="700" cy="640" r="108" fill="#000"/>
      <circle cx="700" cy="640" r="92" fill="#fff"/>
      <path d="M670 626 v-20 a30 30 0 0 1 60 0 v20" fill="none" stroke="#000" stroke-width="15" stroke-linecap="round"/>
      <rect x="656" y="624" width="88" height="66" rx="14" fill="#000"/>
    </mask>
    <g id="mark"><rect width="1024" height="1024" fill="#FFFFFF" mask="url(#m)"/></g>
  </svg>`,
  0.78,
);
const backgroundOnly = svg.replace(/<g id="mark">[\s\S]*<\/g>\s*<\/svg>/, '</svg>');

const jobs = [
  ['assets/icon.png', svg, 1024],
  ['assets/favicon.png', svg, 48],
  ['assets/splash-icon.png', markOnly, 1024],
  ['assets/android-icon-foreground.png', scaled(markOnly, 0.78), 1024],
  ['assets/android-icon-background.png', backgroundOnly, 1024],
  ['assets/android-icon-monochrome.png', mono, 1024],
  ['public/icons/icon-192.png', svg, 192],
  ['public/icons/icon-512.png', svg, 512],
  ['public/icons/maskable-512.png', svg, 512],
  ['public/icons/apple-touch-icon.png', svg, 180],
  ['assets/brand/mark.png', svg, 96], // in-app brand mark (sidebar, top bar, welcome)
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
for (const [file, source, size] of jobs) {
  await page.setViewportSize({ width: size, height: size });
  const sized = source.replace('<svg ', `<svg width="${size}" height="${size}" `);
  await page.setContent(`<html><body style="margin:0;background:transparent">${sized}</body></html>`);
  await page.locator('svg').screenshot({ path: file, omitBackground: true });
  console.log(`${file} (${size}px)`);
}
await browser.close();
