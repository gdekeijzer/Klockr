# Security policy

This project controls live-show behavior, share links and potentially production displays. Security bugs can therefore have operational impact even when no sensitive personal data is involved.

## Do not commit

- passwords;
- API keys;
- access tokens;
- private keys;
- real `.env` files;
- production database dumps;
- share URLs/tokens from real productions.

Use `.env.example` for names and documentation only.

## Security design

See `docs/SECURITY_MODEL.md`.

Core requirements include:

- scoped/revocable share tokens;
- permission-based RBAC;
- short-lived pairing codes;
- rate limiting on anonymous creation/pairing/auth endpoints;
- audit logging of emergency lock overrides;
- explicit, visible and audited Platform Admin impersonation;
- strict separation of Board shares, temporary role links, Device credentials and API credentials;
- sanitized Board content;
- server-side authorization on every mutation;
- secure token generation using cryptographic randomness.

## Dependency vulnerabilities — accepted risks

Reviewed with `pnpm audit` / `pnpm audit --prod` on 2026-11-09 (main `e8f95d5`). Both findings are **accepted/tolerated risk**: development tooling only, the vulnerable code path is not reachable in KLOCKR, the available fixes would force a dependency outside the major range its upstream supports, and there is no production-runtime exposure. No `pnpm` overrides are used. The Dependabot alerts are dismissed as *Risk tolerable / vulnerable code not used*.

| Advisory | Package / path | Why KLOCKR is not exposed |
| --- | --- | --- |
| [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) — esbuild dev server sends `Access-Control-Allow-Origin: *` (fixed in esbuild 0.25.0) | `esbuild@0.18.20`, dev-only, transitive: `packages/db` → `drizzle-kit@0.31.11` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` (pins `~0.18.20`) | The issue is in esbuild's `serve` dev server. `@esbuild-kit/core-utils` only uses `transform`/`transformSync`, and `drizzle-kit` does not load `@esbuild-kit` at all. KLOCKR's own builds use esbuild 0.25.x/0.28.x. Not shipped in any runtime. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) / CVE-2026-118764 — minimatch glob-pattern amplification DoS (fixed in minimatch 11.0.1, no patched 10.x) | `minimatch@10.2.6`, dev-only, transitive via `eslint@10`, `@eslint/config-array`, `typescript-eslint@8` (all declare `^10`) | Exploitation needs an attacker-controlled glob pattern. Patterns come only from KLOCKR's own lint/TypeScript configuration; KLOCKR code does not use minimatch and accepts no glob input. `pnpm audit --prod` lists it only because `typescript-eslint` is a peer dependency of `@klockr/config`, which is not part of any runtime. |

We upgrade as soon as the upstream dependencies allow a supported safe version (drizzle-kit without `@esbuild-kit`, ESLint/typescript-eslint on minimatch >= 11.0.1). Re-check with `pnpm audit` on every dependency update.

## Reporting

A private reporting channel has not yet been selected. Do not publish a real vulnerability in a public issue until a project contact/security process exists.
