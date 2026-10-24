// Copies on-device OCR / PDF assets into public/ so the web build serves them from its own origin.
// Run automatically before `build:web` and `web`. Outputs are git-ignored.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const copy = (from, to) => {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
};

const tess = pkgDir('tesseract.js');
copy(join(tess, 'dist/tesseract.min.js'), 'public/ocr/tesseract.min.js');
copy(join(tess, 'dist/worker.min.js'), 'public/ocr/worker.min.js');
const core = pkgDir('tesseract.js-core');
for (const f of readdirSync(core)) if (/^tesseract-core.*lstm\.wasm\.js$/.test(f)) copy(join(core, f), `public/ocr/core/${f}`);
copy(join(pkgDir('@tesseract.js-data/jpn'), '4.0.0_best_int/jpn.traineddata.gz'), 'public/ocr/lang/jpn.traineddata.gz');

const pdf = pkgDir('pdfjs-dist');
copy(join(pdf, 'legacy/build/pdf.min.mjs'), 'public/pdfjs/pdf.min.mjs');
copy(join(pdf, 'legacy/build/pdf.worker.min.mjs'), 'public/pdfjs/pdf.worker.min.mjs');
console.log('vendor assets copied to public/ocr and public/pdfjs');
