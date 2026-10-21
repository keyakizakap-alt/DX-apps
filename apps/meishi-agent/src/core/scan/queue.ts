// Import queue (S04/S05): up to 50 cards per session, persisted encrypted after every state
// change so a crash or reload resumes where it stopped. Failures affect only their own row.
import { sha256Hex } from '../crypto/hash';
import type { ScanItem } from '../domain/schemas';
import type { VaultSession } from '../store/session';
import type { OcrEngine } from './ocr';

export const MAX_SESSION_ITEMS = 50;
export const OCR_TIMEOUT_MS = 90_000;

export interface CapturedImage {
  jpeg: Uint8Array;
  sourceName?: string;
  back?: Uint8Array;
}

export class QueueFullError extends Error {
  constructor(readonly accepted: number) {
    super(`1回の取り込みは最大${MAX_SESSION_ITEMS}枚です。${accepted}枚を追加しました。`);
  }
}

export function activeItems(session: VaultSession): ScanItem[] {
  return session.all('scanItem').filter((i) => i.status !== 'done').sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.index - b.index);
}

export function currentSessionId(session: VaultSession): string | undefined {
  return activeItems(session)[0]?.sessionId;
}

/** Adds images to the open import session (or starts one). Returns the created items and duplicates skipped. */
export async function enqueueImages(session: VaultSession, images: CapturedImage[]): Promise<{ items: ScanItem[]; duplicates: number }> {
  const active = activeItems(session);
  const sessionId = active[0]?.sessionId ?? session.newId('session');
  const inSession = active.filter((i) => i.sessionId === sessionId);
  const knownHashes = new Set(session.all('scanItem').map((i) => i.imageHash).filter(Boolean));
  const room = MAX_SESSION_ITEMS - inSession.length;
  const items: ScanItem[] = [];
  let duplicates = 0;
  for (const img of images) {
    if (items.length >= room) break;
    const hash = await sha256Hex(session.provider, img.jpeg);
    if (knownHashes.has(hash)) {
      duplicates++;
      continue;
    }
    knownHashes.add(hash);
    const frontBlobId = await session.putImage(img.jpeg);
    const backBlobId = img.back ? await session.putImage(img.back) : undefined;
    items.push(session.build('scanItem', { sessionId, index: inSession.length + items.length, status: 'queued', frontBlobId, backBlobId, sourceName: img.sourceName?.slice(0, 200), imageHash: hash, attempts: 0 }));
  }
  if (items.length) await session.commit(items, { action: 'scan.import', count: items.length });
  if (images.length - duplicates > room) throw Object.assign(new QueueFullError(items.length), { items, duplicates });
  return { items, duplicates };
}

/** After a reload, items that were mid-recognition go back to the queue. */
export async function recoverInterrupted(session: VaultSession): Promise<number> {
  const stuck = session.all('scanItem').filter((i) => i.status === 'recognizing');
  if (stuck.length) await session.commit(stuck.map((i) => ({ ...i, status: 'queued' as const })));
  return stuck.length;
}

export async function retryItem(session: VaultSession, id: string): Promise<void> {
  const item = session.get(id, 'scanItem');
  if (!item || item.status !== 'failed') return;
  await session.commit([{ ...item, status: 'queued', error: undefined, attempts: 0 }]);
}

export async function removeItem(session: VaultSession, id: string): Promise<void> {
  const item = session.get(id, 'scanItem');
  if (!item) return;
  if (!item.cardId) {
    await session.deleteImage(item.frontBlobId);
    if (item.backBlobId) await session.deleteImage(item.backBlobId);
  }
  await session.remove([id], false);
}

export interface QueueRunner {
  stop(): void;
  readonly done: Promise<number>;
}

/** Processes queued items one at a time until none remain or `stop()` is called. */
export function runQueue(session: VaultSession, ocr: OcrEngine, onProgress?: (itemId: string, ratio: number) => void): QueueRunner {
  let stopped = false;
  const done = (async () => {
    let processed = 0;
    for (;;) {
      if (stopped || !session.unlocked) break;
      const next = activeItems(session).find((i) => i.status === 'queued');
      if (!next) break;
      await session.commit([{ ...next, status: 'recognizing', attempts: next.attempts + 1 }]);
      try {
        const image = await session.getImage(next.frontBlobId);
        if (!image) throw new Error('画像が見つかりません');
        const lines = await withTimeout(ocr.recognize(image, (r) => onProgress?.(next.id, r)), OCR_TIMEOUT_MS);
        const current = session.get(next.id, 'scanItem');
        if (!current) continue; // removed meanwhile
        await session.commit([{ ...current, status: 'needs_review', ocrLines: lines.slice(0, 200).map((l) => ({ text: l.text.slice(0, 400), confidence: l.confidence })), error: undefined }]);
        await session.audit('scan.ocr');
        processed++;
      } catch (e) {
        if (!session.unlocked) break;
        const current = session.get(next.id, 'scanItem');
        if (!current) continue;
        const message = e instanceof Error ? e.message.slice(0, 200) : 'OCRに失敗しました';
        // The row stays failed until the user retries it or enters the fields manually (S06).
        await session.commit([{ ...current, status: 'failed', error: message }]);
        await session.audit('scan.ocr', 1, 'failure');
      }
    }
    return processed;
  })();
  return { stop: () => (stopped = true), done };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('OCRがタイムアウトしました')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
