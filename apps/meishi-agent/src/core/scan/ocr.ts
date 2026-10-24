import type { OcrLine } from '../domain/ocr-parse';

/** On-device OCR engine. Implementations must not send images anywhere. */
export interface OcrEngine {
  readonly id: 'tesseract-jpn' | 'mlkit-ja' | 'manual';
  readonly label: string;
  available(): Promise<boolean>;
  recognize(jpeg: Uint8Array, onProgress?: (ratio: number) => void): Promise<OcrLine[]>;
  dispose(): Promise<void>;
}

/** Used where no on-device Japanese OCR is available: the user types the fields (S06). */
export const manualOcr: OcrEngine = {
  id: 'manual',
  label: '手入力（端末内OCRなし）',
  available: async () => true,
  recognize: async () => [],
  dispose: async () => {},
};
