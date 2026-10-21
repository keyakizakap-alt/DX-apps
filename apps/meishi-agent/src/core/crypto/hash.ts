import { toHex } from './bytes';
import type { CryptoProvider } from './provider';

export async function sha256Hex(provider: CryptoProvider, data: Uint8Array): Promise<string> {
  return toHex(await provider.sha256(data));
}
