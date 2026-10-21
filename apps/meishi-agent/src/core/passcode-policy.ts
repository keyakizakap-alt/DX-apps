// Device passcode rules (web). The passcode is stretched with PBKDF2-600k AND bound to a
// non-extractable device key, but weak choices are still refused up front.
const COMMON = ['password', 'passw0rd', 'qwertyuiop', '1234567890', '0123456789', 'iloveyou', 'abcdefghij', 'meishikanri', 'admin12345', 'welcome123'];

export const PASSCODE_MIN_LENGTH = 10;

/** Returns a Japanese error message, or null when acceptable. */
export function passcodeProblem(passcode: string): string | null {
  const p = passcode.normalize('NFKC');
  if (p.length < PASSCODE_MIN_LENGTH) return `パスコードは${PASSCODE_MIN_LENGTH}文字以上にしてください`;
  if (/^(.)\1+$/.test(p)) return '同じ文字の繰り返しは使えません';
  if (/^\d+$/.test(p) && p.length < 14) return '数字だけの場合は14桁以上にしてください';
  const lower = p.toLowerCase();
  if (COMMON.some((c) => lower.includes(c))) return 'よく使われる文字列が含まれています';
  if (isSequential(lower)) return '連続した文字（abcd… / 1234…）だけのパスコードは使えません';
  return null;
}

function isSequential(s: string): boolean {
  if (s.length < 4) return false;
  let up = true;
  let down = true;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}
