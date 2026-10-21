import { toHex } from '../crypto/bytes';
import { ID_PREFIX, type EntityType } from './schemas';

export type RandomBytes = (n: number) => Uint8Array;

export function newId(kind: EntityType | 'blob' | 'session', randomBytes: RandomBytes): string {
  return `${ID_PREFIX[kind]}_${toHex(randomBytes(12))}`;
}
