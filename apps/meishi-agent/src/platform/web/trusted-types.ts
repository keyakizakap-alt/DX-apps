// Trusted Types policies. The CSP (`require-trusted-types-for 'script'; trusted-types meishi default`)
// forbids creating any other policy, and these policies only ever produce script URLs for the
// self-hosted engine files. They define no createHTML / createScript, so string-to-HTML and
// eval-like sinks stay blocked for all code, including injected code.
//   meishi  — used explicitly by our own code (script loader, workers, service worker)
//   default — applied by the browser when vendor code (Tesseract.js) assigns a plain string URL
const ALLOWED = /^\/(ocr\/(tesseract\.min\.js|worker\.min\.js)|pdfjs\/(loader\.mjs|pdf\.worker\.min\.mjs)|sw\.js)$/;

export function isAllowedScriptURL(input: string, origin: string): boolean {
  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    return false;
  }
  return url.origin === origin && !url.search && !url.hash && ALLOWED.test(url.pathname);
}

interface TrustedTypePolicyLike {
  createScriptURL(input: string): unknown;
}
interface TrustedTypesFactory {
  createPolicy(name: string, rules: { createScriptURL(u: string): string }): TrustedTypePolicyLike;
}
let policy: TrustedTypePolicyLike | null | undefined;

function validate(u: string): string {
  if (!isAllowedScriptURL(u, globalThis.location.origin)) throw new TypeError('blocked script URL');
  return u;
}

/** Installs both policies once (web only). Must run before vendor scripts are loaded. */
export function installTrustedTypes(): void {
  if (policy !== undefined) return;
  const tt = (globalThis as unknown as { trustedTypes?: TrustedTypesFactory }).trustedTypes;
  if (!tt) {
    policy = null;
    return;
  }
  policy = tt.createPolicy('meishi', { createScriptURL: validate });
  tt.createPolicy('default', { createScriptURL: validate });
}

/** Returns a TrustedScriptURL where Trusted Types is enforced; the validated string elsewhere. */
export function trustedScriptURL(url: string): string {
  installTrustedTypes();
  if (policy) return policy.createScriptURL(url) as string;
  return validate(url);
}
