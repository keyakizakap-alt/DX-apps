# Security and information handling

## Trust boundaries

On Vercel, `api/index.mjs` uses `server/vercel-handler.mjs` to provide intentional public access without a login, password, or authentication cookie. This adapter replaces caller-supplied Sites identity headers with one shared public identity; this is compatibility context for the Worker, not authenticated visitor identity. Only configured HTTPS deployment origins are accepted, and state-changing requests must have a matching Origin. API keys are exclusively operator-managed secrets (`OPENROUTER_API_KEY`), never client code or source files. The client has no key input or key override capability. Incoming `X-OpenRouter-Key` headers are rejected. The status API exposes only whether the server is configured, not its key. Anonymous callers can incur charges on the operator account. Configure provider-side spending caps and platform access/rate restrictions. The Worker provides a shared per-instance maximum of 3 active calls and 60 calls/minute, not a global spending limit or user identity management. User materials are kept in request memory and the individual browser; there is no shared data listing or persistence.

Sites dispatch authenticates the visitor and supplies `oai-authenticated-user-id` and `oai-authenticated-user-email`. The Worker also requires the email to be in `ALLOWED_USER_EMAILS`. Do not deploy this Worker on a public origin that permits callers to supply those headers directly. Preserve the owner-private Sites audience. The development server supplies a synthetic identity and binds only to loopback; never expose it to the internet.

All materials and generated output are untrusted. The API accepts only a fixed agent ID, allowlisted model, data object, and search boolean. System instructions and schemas are pinned server-side. The model has no mail, publishing, filesystem, GitHub, shell, or arbitrary HTTP tools. Web search is explicit, research-only, and restricted to public material.

## Enforced controls

- Private Sites identity and owner allowlist; intentional public access on Vercel; same-origin POST; JSON only; no cross-origin CORS.
- CSP allows scripts/styles/connections only from the same origin; no inline script or third-party font loading. Output is HTML-escaped, including WordPress exports.
- Maximum request 750 kB and upstream response 1.5 MB; bounded streaming reads; 3 concurrent calls and 60 calls/minute per identity per Worker instance; 100-second upstream timeout.
- No API key in model input, artifacts, source, or application logs. Only the operator-managed server secret is used. Client-supplied keys are rejected.
- Missing consent, restricted classification, internal web search, internal unmasked input, credential-like material, and secret-like model output are denied.
- No-training and ZDR routing requirements; no relaxation after provider failure.
- Literal citation and source-ID checks; output schema validation; supervisor intervention for unverifiable findings and unconfirmed claims.
- Publication package approval is bound to artifact hashes. No connected external publication capability exists.
- No material stored in server persistence, cookies, localStorage or IndexedDB. Cache-Control no-store, including Vercel/CDN cache headers. Explicit downloads are the user's responsibility.

## Residual risks and operational requirements

Prompt injection cannot be eliminated by a prompt. The containment boundary is the absence of privileged model tools and the server's fixed egress/capability policy. Citation existence is not proof of truth. PII detectors do not cover all names, addresses, or contextual identifiers; custom redaction and human source review remain mandatory. Network and platform administrators may operate infrastructure logs outside this application's control.

The in-memory audit chain detects modification to a saved chain unless the entire chain is regenerated; it is not an independently signed or durable audit record. Multi-user enterprise deployment requires durable append-only audit storage and organization membership management. Per-instance throttling is not a global spending limit. Use restricted OpenRouter keys and configure a financial cap. Verify OpenRouter, upstream providers, optional search, and hosting data-processing terms, location, and retention before live confidential material is used.

## Secrets and incident handling

Configure `OPENROUTER_API_KEY` as a hosting secret, not as a source file. No Vercel access password or session signing secret is required. Restrict models with `ALLOWED_MODELS`. Rotate exposed keys immediately in OpenRouter, remove server/session credentials, inspect account usage, and review access. Do not put sensitive data into GitHub issues. Contact the repository owner privately for incident reports; no external security report is sent automatically by this application.

## Required verification before changes

Run security and agent-state regression tests. Check anonymous/cross-origin rejection, source bounds, restricted-data denial, masking, abort/retry, model allowlist, HTML escaping, approval invalidation, and secret absence from the built client. Do not weaken routing controls to make an unsupported provider appear to work.
