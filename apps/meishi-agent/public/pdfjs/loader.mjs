// Same-origin ES module loader for pdf.js (pdf.min.mjs and its worker are copied here at build
// time by scripts/copy-vendor.mjs). Exposes the module for src/platform/web/image.ts, which also
// creates the worker itself so its URL passes through the app's Trusted Types policy.
import * as pdfjs from './pdf.min.mjs';

globalThis.__meishiPdfjs = pdfjs;
