# Learnings

## [LRN-20261102-001] runtime_compatibility

**Logged**: 2026-11-02
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
Cloudflare workerd rejects fetch `redirect: "error"` before sending any request; use `manual` and reject 3xx explicitly.

### Details
Node-only fetch mocks accepted the option and missed the incompatibility. Actual workerd with compatibility date 2026-05-15 threw `TypeError: Invalid redirect value, must be one of "follow" or "manual"`. This caused all real service requests to fail immediately. `AbortSignal.timeout()` was separately verified inside a request handler and works. The corrected implementation uses manual redirects, cancels redirect response bodies, and returns a sanitized UPSTREAM_REDIRECT error.

### Suggested Action
Keep the real-workerd regression test with an in-process outbound service. It executes production code, simulates a redirect, and verifies exactly one request so credentials cannot be forwarded. Use this pattern for runtime-specific fetch behavior rather than relying only on Node mocks.

### Metadata
- Source: correction
- Related Files: lib/server/services.ts, tests/workerd-services.test.mjs
- Pattern-Key: cloudflare.fetch.redirect_manual
- Reference: https://developers.cloudflare.com/workers/runtime-apis/request/

## [LRN-20261102-002] unsupported_personal_experience

**Logged**: 2026-11-02
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
A fixed system instruction and a separate UI warning do not ensure generated copy avoids invented personal experience.

### Details
A real Qwen rewrite with no experience input returned a fictional recent visit, despite both system and user requirements forbidding it. The UI warning did not make that draft accurate. The response now receives a focused server check for clear unsupported first-person experience, in addition to a more explicit prompt. A rejected result must not become an editable success or trigger an automatic paid retry. The check is deliberately not presented as comprehensive fact verification.

### Metadata
- Source: real integration test
- Related Files: lib/server/create-copy.ts, tests/create-copy.test.mjs
- Pattern-Key: generation.personal_experience.validation
