// Image intake for the web: validates type/size, decodes, re-encodes to JPEG (which drops EXIF
// such as GPS), applies orientation, caps resolution to bound memory, and renders PDF pages.
import { loadScript } from './script-loader';

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_EDGE = 1600;
export const MAX_PDF_PAGES = 10;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

export class ImportError extends Error {}

export interface ProcessedImage {
  jpeg: Uint8Array;
  sourceName: string;
}

async function canvasToJpeg(canvas: HTMLCanvasElement, quality = 0.85): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob) throw new ImportError('画像を変換できませんでした');
  return new Uint8Array(await blob.arrayBuffer());
}

function drawScaled(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImportError('画像処理に対応していないブラウザです');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export async function processImageFile(file: File): Promise<ProcessedImage[]> {
  if (file.size > MAX_INPUT_BYTES) throw new ImportError(`${file.name}: 20MBを超えるファイルは取り込めません`);
  const type = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : '');
  if (!ACCEPTED.includes(type)) throw new ImportError(`${file.name}: JPEG / PNG / WebP / HEIC / PDF のみ対応しています`);
  if (type === 'application/pdf') return pdfToImages(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ImportError(
      type.includes('hei') ? `${file.name}: このブラウザはHEICを読み込めません。iPhoneの設定で「互換性優先」にするか、JPEGで書き出してください。` : `${file.name}: 画像を読み込めませんでした`,
    );
  }
  try {
    return [{ jpeg: await canvasToJpeg(drawScaled(bitmap, bitmap.width, bitmap.height)), sourceName: file.name }];
  } finally {
    bitmap.close();
  }
}

interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array; isEvalSupported: boolean; disableFontFace?: boolean }): { promise: Promise<PdfDoc>; destroy(): Promise<void> };
}
interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<{ getViewport(o: { scale: number }): { width: number; height: number }; render(o: { canvasContext: CanvasRenderingContext2D; viewport: unknown; canvas: HTMLCanvasElement }): { promise: Promise<void> } }>;
}

async function loadPdfJs(): Promise<PdfJs> {
  const g = globalThis as unknown as { __meishiPdfjs?: PdfJs };
  if (!g.__meishiPdfjs) {
    await loadScript('/pdfjs/loader.mjs', 'module');
    for (let i = 0; i < 50 && !g.__meishiPdfjs; i++) await new Promise((r) => setTimeout(r, 50));
  }
  if (!g.__meishiPdfjs) throw new ImportError('PDF処理エンジンを読み込めませんでした');
  return g.__meishiPdfjs;
}

export async function pdfToImages(file: File): Promise<ProcessedImage[]> {
  const pdfjs = await loadPdfJs();
  // isEvalSupported:false keeps pdf.js from compiling fonts with eval (blocked by our CSP anyway).
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const doc = await task.promise;
  try {
    if (doc.numPages > MAX_PDF_PAGES) throw new ImportError(`${file.name}: ${MAX_PDF_PAGES}ページを超えるPDFは分割してください（${doc.numPages}ページ）`);
    const out: ProcessedImage[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(3, MAX_EDGE / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d')!;
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      out.push({ jpeg: await canvasToJpeg(canvas), sourceName: `${file.name} p${n}` });
    }
    return out;
  } finally {
    await task.destroy(); // frees the worker and document (PDFDocumentProxy.destroy was removed in pdf.js 6)
  }
}

/** Opens the OS file picker. With `capture`, mobile browsers open the rear camera directly. */
export function pickFiles(opts: { capture?: boolean; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = opts.capture ? 'image/*' : 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,.pdf';
    if (opts.capture) input.setAttribute('capture', 'environment');
    input.multiple = opts.multiple ?? !opts.capture;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(Array.from(input.files ?? []));
      input.remove();
    };
    input.oncancel = () => {
      resolve([]);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}

export function bytesToObjectUrl(bytes: Uint8Array, type = 'image/jpeg'): string {
  return URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
}

export function downloadBytes(bytes: Uint8Array | string, filename: string, type: string) {
  const blob = new Blob([typeof bytes === 'string' ? bytes : (bytes as Uint8Array<ArrayBuffer>)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
