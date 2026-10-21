// Browser OCR with Tesseract.js (LSTM) and the bundled Japanese model (jpn, tessdata best_int).
// Combining jpn+eng failed to initialise with tesseract.js 7.0.0 in testing, so jpn alone is used;
// e-mail/URL spacing errors are repaired in core/domain/ocr-parse.ts.
// Worker, WASM core and language data are served from this origin under /ocr/ (copied at build
// time by scripts/copy-vendor.mjs), so images never leave the device and no CDN is contacted.
// Limits: horizontal Japanese text; vertical (縦書き) cards need the jpn_vert model, not bundled.
import type { OcrLine } from '../../core/domain/ocr-parse';
import type { OcrEngine } from '../../core/scan/ocr';
import { loadScript } from './script-loader';

interface TesseractLine {
  text: string;
  confidence: number;
}
interface TesseractWorker {
  recognize(image: Blob, options?: object, output?: object): Promise<{ data: { blocks: { paragraphs: { lines: TesseractLine[] }[] }[] | null; text: string } }>;
  terminate(): Promise<unknown>;
}
interface TesseractGlobal {
  createWorker(langs: string | string[], oem: number, options: Record<string, unknown>): Promise<TesseractWorker>;
}

export function createTesseractOcr(base = '/ocr'): OcrEngine {
  let worker: Promise<TesseractWorker> | null = null;
  let progress: ((r: number) => void) | undefined;
  const getWorker = () => {
    if (!worker) {
      worker = (async () => {
        await loadScript(`${base}/tesseract.min.js`);
        const T = (globalThis as unknown as { Tesseract?: TesseractGlobal }).Tesseract;
        if (!T) throw new Error('OCRエンジンを読み込めませんでした');
        return T.createWorker('jpn', 1 /* OEM.LSTM_ONLY */, {
          workerPath: `${base}/worker.min.js`, // checked by the Trusted Types default policy
          corePath: `${base}/core`,
          langPath: `${base}/lang`,
          gzip: true,
          workerBlobURL: false,
          cacheMethod: 'none',
          logger: (m: { status: string; progress: number }) => {
            if (m.status === 'recognizing text') progress?.(m.progress);
          },
        });
      })().catch((e) => {
        worker = null;
        throw e;
      });
    }
    return worker;
  };
  return {
    id: 'tesseract-jpn',
    label: '端末内OCR（Tesseract 日本語・横書き）',
    async available() {
      return typeof Worker !== 'undefined' && typeof WebAssembly !== 'undefined';
    },
    async recognize(jpeg, onProgress) {
      progress = onProgress;
      const w = await getWorker();
      const { data } = await w.recognize(new Blob([jpeg as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), {}, { blocks: true, text: true });
      const lines: OcrLine[] = [];
      for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
        // Tesseract inserts spaces between Japanese glyphs; collapse those but keep Latin spacing.
        const text = l.text.replace(/(?<=[^\x00-\x7F])\s+(?=[^\x00-\x7F])/g, '').trim();
        if (text) lines.push({ text, confidence: Math.max(0, Math.min(1, l.confidence / 100)) });
      }
      return lines;
    },
    async dispose() {
      const w = worker;
      worker = null;
      if (w) await (await w).terminate();
    },
  };
}
