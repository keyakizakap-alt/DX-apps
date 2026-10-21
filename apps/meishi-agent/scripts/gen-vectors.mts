// Regenerates tests/unit/fixtures/envelope-v1-vectors.json. Run only when the format changes:
//   node scripts/gen-vectors.mts
// The vectors use a fixed nonce; that is acceptable only for test fixtures.
import { writeFileSync, mkdirSync } from 'node:fs';
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const te = new TextEncoder();
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const vmk = Uint8Array.from({ length: 32 }, (_, i) => i);
const cases = [
  { name: 'record-ja', purpose: 'record', purposeId: 1, vaultId: 'v_00112233445566778899aabbccddeeff', objectId: 'c_0001', keyVersion: 1, info: 'meishi-card/v1/record/k1', nonceHex: '000102030405060708090a0b', plaintext: '{"name":"架空 花子","company":"テスト商事株式会社"}' },
  { name: 'blob-ascii', purpose: 'blob', purposeId: 2, vaultId: 'v_00112233445566778899aabbccddeeff', objectId: 'b_0001', keyVersion: 1, info: 'meishi-card/v1/blob/k1', nonceHex: 'a0a1a2a3a4a5a6a7a8a9aaab', plaintext: 'test-image-bytes' },
];
const out = cases.map((c) => {
  const key = hkdf(sha256, vmk, te.encode(c.vaultId), te.encode(c.info), 32);
  const header = new Uint8Array([1, c.purposeId, 0, 0, 0, c.keyVersion]);
  const aad = new Uint8Array([...header, ...te.encode(`meishi-card/v1|${c.purpose}|${c.vaultId}|${c.objectId}|${c.keyVersion}`)]);
  const nonce = Buffer.from(c.nonceHex, 'hex');
  const sealed = gcm(key, nonce, aad).encrypt(te.encode(c.plaintext));
  return { ...c, envelopeHex: hex(new Uint8Array([...header, ...nonce, ...sealed])) };
});
mkdirSync('tests/unit/fixtures', { recursive: true });
writeFileSync('tests/unit/fixtures/envelope-v1-vectors.json', JSON.stringify({ generator: 'scripts/gen-vectors.ts (@noble/ciphers + @noble/hashes)', vmkHex: hex(vmk), cases: out }, null, 2) + '\n');
