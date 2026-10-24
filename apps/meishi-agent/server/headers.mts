// Response security headers, shared by the Node server (app.mts) and the Vercel CDN routes
// (scripts/build-vercel.mjs) so both deployments send the same policy.
export function securityHeaders(https: boolean, workerScript = false): Record<string, string> {
  return {
    'content-security-policy': [
      "default-src 'self'",
      ...(workerScript ? [] : ["require-trusted-types-for 'script'", 'trusted-types meishi default']),
      "script-src 'self' 'wasm-unsafe-eval'",
      "style-src 'self' 'unsafe-inline'", // react-native-web injects <style> elements at runtime
      "img-src 'self' blob: data:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), hid=(), display-capture=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-resource-policy': 'same-origin',
    'origin-agent-cluster': '?1',
    'x-permitted-cross-domain-policies': 'none',
    'x-frame-options': 'DENY',
    ...(https ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

