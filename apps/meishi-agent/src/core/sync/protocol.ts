// Wire format between devices and the sync server. Only opaque ids, revisions, flags and base64
// ciphertext cross the network. Shared by the client and server (server re-validates with Zod).
import { z } from 'zod';

export const OBJECT_ID = /^[a-z]{1,4}_[0-9a-f]{24}$/;
export const MAX_ENVELOPE_BASE64 = 256 * 1024; // records
export const MAX_BLOB_BYTES = 3 * 1024 * 1024; // encrypted images
export const MAX_PUSH = 200;
export const MAX_PULL = 500;

const base64 = z.string().max(MAX_ENVELOPE_BASE64).regex(/^[A-Za-z0-9+/]*={0,2}$/);

export const PushChange = z.object({
  objectId: z.string().regex(OBJECT_ID),
  baseRevision: z.number().int().min(0).nullable(),
  deleted: z.boolean(),
  envelope: base64.nullable(),
}).strict().refine((c) => c.deleted === (c.envelope === null), 'deleted ⇔ envelope=null');
export type PushChange = z.infer<typeof PushChange>;

export const PushRequest = z.object({ deviceId: z.string().regex(/^d_[0-9a-f]{24}$/), changes: z.array(PushChange).max(MAX_PUSH) }).strict();
export type PushRequest = z.infer<typeof PushRequest>;

export const RemoteObject = z.object({
  objectId: z.string(),
  revision: z.number().int(),
  deleted: z.boolean(),
  envelope: z.string().nullable(),
  seq: z.number().int(),
});
export type RemoteObject = z.infer<typeof RemoteObject>;

export const PushResult = z.discriminatedUnion('status', [
  z.object({ objectId: z.string(), status: z.literal('ok'), revision: z.number().int(), seq: z.number().int() }),
  z.object({ objectId: z.string(), status: z.literal('conflict'), current: RemoteObject }),
]);
export type PushResult = z.infer<typeof PushResult>;

export const PushResponse = z.object({ results: z.array(PushResult) });
export const PullResponse = z.object({ changes: z.array(RemoteObject), cursor: z.number().int(), hasMore: z.boolean() });
export type PullResponse = z.infer<typeof PullResponse>;

export const RecoveryEnvelopeWire = z.object({
  format: z.literal('meishi-recovery-envelope/v1'),
  vaultId: z.string().regex(/^v_[0-9a-f]{32}$/),
  keyVersion: z.number().int().min(1),
  envelope: z.string().max(512).regex(/^[A-Za-z0-9+/]*={0,2}$/),
}).strict();

export interface SyncTransport {
  push(req: PushRequest): Promise<PushResult[]>;
  pull(cursor: number, limit: number): Promise<PullResponse>;
  putBlob(id: string, envelope: Uint8Array): Promise<void>;
  getBlob(id: string): Promise<Uint8Array | null>;
  deleteBlob(id: string): Promise<void>;
}

export class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: 'offline' | 'unauthorized' | 'forbidden' | 'quota' | 'rate_limited' | 'server' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
}
