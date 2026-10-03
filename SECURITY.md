# Security and information handling

## Trust boundaries

On Vercel, `api/index.mjs` wraps the same Worker with `server/vercel-session.mjs`. All app assets and API calls are routed through this authenticated function; `public/` must remain empty apart from `.gitkeep`. Do not configure `dist/` as a publicly served output directory. A strong team access password and a separate random signing secret are mandatory; missing secrets or untrusted deployment origins fail closed. Login uses same-origin POST and issues a four-hour signed HttpOnly, Secure, SameSite=Strict cookie. No materials or API keys are stored in that cookie. Caller-provided Sites identity headers are overwritten only after session verification. This is single-owner/team authentication, not individual RBAC, SSO, or MFA. Login throttling is per instance; use Vercel Firewall for distributed controls. Logout deletes the browser cookie; rotating either access secret revokes all issued tokens, including copied tokens.

Sites dispatch authenticates the visitor and supplies `oai-authenticated-user-id` and `oai-authenticated-user-email`. The Worker also requires the email to be in `ALLOWED_USER_EMAILS`. Do not deploy this Worker on a public origin that permits callers to supply those headers directly. Preserve the owner-private Sites audience. The development server supplies a synthetic identity and binds only to loopback; never expose it to the internet.

All materials and generated output are untrusted. The API accepts only a fixed agent ID, allowlisted model, data object, and search boolean. System instructions and schemas are pinned server-side. The model has no mail, publishing, filesystem, GitHub, shell, or arbitrary HTTP tools. Web search is explicit, research-only, and restricted to public material.

## Enforced controls

- API identity and owner allowlist; same-origin POST; JSON only; no cross-origin CORS.
- CSP allows scripts/styles/connections only from the same origin; no inline script or third-party font loading. Output is HTML-escaped, including WordPress exports.
- Maximum request 750 kB and upstream response 1.5 MB; bounded streaming reads; 3 concurrent calls and 60 calls/minute per identity per Worker instance; 100-second upstream timeout.
- No API key in model input, artifacts, source, or application logs. Server secret is preferred. Session BYOK is passed only to this origin and kept only in memory.
- Missing consent, restricted classification, internal web search, internal unmasked input, credential-like material, and secret-like model output are denied.
- No-training and ZDR routing requirements; no relaxation after provider failure.
- Literal citation and source-ID checks; output schema validation; supervisor intervention for unverifiable findings and unconfirmed claims.
- Publication package approval is bound to artifact hashes. No connected external publication capability exists.
- No material stored in server persistence, cookies, localStorage or IndexedDB. Only the Vercel authentication token is stored in a cookie. Cache-Control no-store, including Vercel/CDN cache headers. Explicit downloads are the user's responsibility.

## Residual risks and operational requirements

Prompt injection cannot be eliminated by a prompt. The containment boundary is the absence of privileged model tools and the server's fixed egress/capability policy. Citation existence is not proof of truth. PII detectors do not cover all names, addresses, or contextual identifiers; custom redaction and human source review remain mandatory. Network and platform administrators may operate infrastructure logs outside this application's control.

The in-memory audit chain detects modification to a saved chain unless the entire chain is regenerated; it is not an independently signed or durable audit record. Multi-user enterprise deployment requires durable append-only audit storage and organization membership management. Per-instance throttling is not a global spending limit. Use restricted OpenRouter keys and configure a financial cap. Verify OpenRouter, upstream providers, optional search, and hosting data-processing terms, location, and retention before live confidential material is used.

## Secrets and incident handling

Configure `OPENROUTER_API_KEY` as a hosting secret, not as a source file. Vercel also requires `APP_ACCESS_PASSWORD` and `SESSION_SECRET` as secrets. Restrict models with `ALLOWED_MODELS`. Rotate exposed keys immediately in OpenRouter, remove server/session credentials, inspect account usage, and review access. Do not put sensitive data into GitHub issues. Contact the repository owner privately for incident reports; no external security report is sent automatically by this application.

## Required verification before changes

Run security and agent-state regression tests. Check anonymous/cross-origin rejection, source bounds, restricted-data denial, masking, abort/retry, model allowlist, HTML escaping, approval invalidation, and secret absence from the built client. Do not weaken routing controls to make an unsupported provider appear to work.
