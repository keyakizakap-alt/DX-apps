// Same-origin ES module loader for pdf.js (pdf.min.mjs and its worker are copied here at build
// time by scripts/copy-vendor.mjs). Exposes the module for src/platform/web/image.ts.
import * as pdfjs from './pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
globalThis.__meishiPdfjs = pdfjs;
