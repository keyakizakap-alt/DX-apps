// Device-side client for the sync server. Web uses an HttpOnly cookie (same origin); native
// passes a bearer token kept in the OS key store. Responses are re-validated with Zod.
import { z } from 'zod';
import type { RecoveryEnvelope } from '../crypto/vault';
import type { DraftResult, ExternalDraftRequest } from '../ai/request';
import { PullResponse, PushResponse, RecoveryEnvelopeWire, SyncHttpError, type PushRequest, type PushResult, type SyncTransport } from './protocol';

export interface ApiClientOptions {
  baseUrl: string; // '' for same-origin web
  client: 'web' | 'native';
  getToken?: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

const ErrorBody = z.object({ error: z.string(), message: z.string().optional() }).partial();

export class ApiClient implements SyncTransport {
  constructor(private readonly opts: ApiClientOptions) {}

  private async request(method: string, path: string, body?: unknown, raw?: Uint8Array): Promise<Response> {
    const headers: Record<string, string> = { 'x-meishi-client': this.opts.client };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (raw) headers['content-type'] = 'application/octet-stream';
    const token = this.opts.getToken ? await this.opts.getToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${this.opts.baseUrl}${path}`, {
        method,
        headers,
        body: raw ? (raw as Uint8Array<ArrayBuffer>) : body !== undefined ? JSON.stringify(body) : undefined,
        credentials: this.opts.client === 'web' ? 'same-origin' : 'omit',
      });
    } catch {
      throw new SyncHttpError(0, 'offline', 'サーバーに接続できません（オフラインの可能性）。変更は端末内に保存されています。');
    }
    if (!res.ok) {
      const parsed = ErrorBody.safeParse(await res.json().catch(() => ({})));
      const message = parsed.success && parsed.data.message ? parsed.data.message : `HTTP ${res.status}`;
      const code = res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 413 ? 'quota' : res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'server' : 'invalid';
      const err = new SyncHttpError(res.status, code, message);
      (err as SyncHttpError & { apiCode?: string }).apiCode = parsed.success ? parsed.data.error : undefined;
      throw err;
    }
    return res;
  }

  private async json<T>(schema: z.ZodType<T>, method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.request(method, path, body);
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) throw new SyncHttpError(res.status, 'invalid', 'サーバー応答の形式が不正です');
    return parsed.data;
  }

  health() {
    return this.json(z.object({ ok: z.boolean(), ai: z.boolean(), aiDestination: z.string().nullable() }), 'GET', '/api/health');
  }

  startSignIn(email: string) {
    return this.json(z.object({ challengeId: z.string(), expiresInSec: z.number() }), 'POST', '/api/auth/start', { email });
  }

  verifySignIn(challengeId: string, code: string, deviceLabel: string) {
    return this.json(z.object({ accountId: z.string(), deviceId: z.string(), hasVault: z.boolean(), token: z.string().optional() }), 'POST', '/api/auth/verify', { challengeId, code, deviceLabel });
  }

  me() {
    return this.json(z.object({ accountId: z.string(), deviceId: z.string(), hasVault: z.boolean() }), 'GET', '/api/me');
  }

  async signOut() {
    await this.request('POST', '/api/auth/logout', {});
  }

  devices() {
    return this.json(z.object({ devices: z.array(z.object({ id: z.string(), label: z.string(), createdAt: z.string(), lastSeenAt: z.string(), revoked: z.boolean(), current: z.boolean() })) }), 'GET', '/api/devices');
  }

  async revokeDevice(id: string) {
    await this.request('POST', `/api/devices/${id}/revoke`, {});
  }

  async getRecoveryEnvelope(): Promise<RecoveryEnvelope | null> {
    try {
      return await this.json(RecoveryEnvelopeWire, 'GET', '/api/vault');
    } catch (e) {
      if (e instanceof SyncHttpError && e.status === 404) return null;
      throw e;
    }
  }

  async putRecoveryEnvelope(env: RecoveryEnvelope) {
    await this.request('PUT', '/api/vault', env);
  }

  async deleteAccount() {
    await this.request('DELETE', '/api/account', { confirm: 'DELETE' });
  }

  async push(req: PushRequest): Promise<PushResult[]> {
    return (await this.json(PushResponse, 'POST', '/api/sync/push', req)).results;
  }

  pull(cursor: number, limit: number) {
    return this.json(PullResponse, 'GET', `/api/sync/pull?cursor=${cursor}&limit=${limit}`);
  }

  async putBlob(id: string, envelope: Uint8Array) {
    await this.request('PUT', `/api/blobs/${id}`, undefined, envelope);
  }

  async getBlob(id: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await (await this.request('GET', `/api/blobs/${id}`)).arrayBuffer());
    } catch (e) {
      if (e instanceof SyncHttpError && e.status === 404) return null;
      throw e;
    }
  }

  async deleteBlob(id: string) {
    await this.request('DELETE', `/api/blobs/${id}`);
  }

  createConsent(requestHash: string, destination: string) {
    return this.json(z.object({ consentId: z.string(), expiresInSec: z.number() }), 'POST', '/api/ai/consent', { requestHash, destination });
  }

  draft(consentId: string, request: ExternalDraftRequest): Promise<{ draft: DraftResult; destination: string }> {
    return this.json(z.object({ draft: z.object({ subject: z.string(), body: z.string(), caveats: z.array(z.string()) }), destination: z.string() }), 'POST', '/api/ai/draft', { consentId, request });
  }
}
