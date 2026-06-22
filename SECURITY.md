# Security Policy & Posture

Secure Messenger is an end-to-end encrypted messenger. This document tracks the
security model, known weaknesses, and the hardening roadmap. A detailed,
finding-by-finding audit lives in [`docs/SECURITY_REVIEW.md`](docs/SECURITY_REVIEW.md).

## Reporting

If you find a vulnerability, please open a private security advisory on the GitHub
repository (Security → Advisories) rather than a public issue.

## Threat model

- **In scope:** a malicious or compromised server/database operator (should not be able
  to read message plaintext), passive network attackers, other authenticated users
  (must be confined by row-level security), and theft of the at-rest server database.
- **Partially in scope / being hardened:** an active server that tampers with published
  public keys (MITM), client-side XSS, supply-chain compromise of the crypto library,
  and local attackers with access to the browser's storage.
- **Out of scope (current):** a fully compromised client device with a live session.

## Cryptography

- Identity keys: X25519 (TweetNaCl `box`). Message/file encryption: XSalsa20-Poly1305
  (`secretbox`). Key derivation: HKDF-SHA256. Backups: PBKDF2-SHA256 (600k) + AES-256-GCM.
- The user password is the root secret that unwraps the identity secret key; a 24-word
  recovery key is the backup unwrap path.

## Remediation status

The full audit (`docs/SECURITY_REVIEW.md`, 49 findings) is now substantially
remediated and live across both apps (messaging_app + money_tracker, which shares
the messaging core via the `lib/messaging` submodule).

**Fixed & live:**
- Crypto library **self-hosted** (no third-party CDN). *(was: no SRI)*
- Identity secret key **encrypted at rest** with a non-extractable WebCrypto key. *(was: plaintext in IndexedDB)*
- **TOFU public-key pinning** with warn-on-change; safety-number surfaced in settings. *(was: silent MITM)*
- Decrypt failures **fail loud** (no silent re-derive masking tampering); null/plaintext facade fail-closed.
- Key-material **logging stripped**; verbose logging off by default; plaintext message preview removed from notifications.
- **Content-Security-Policy** on all pages; output **escaping** (XSS) in all render paths.
- **RLS hardened** on the shared DB (participant-scoped attachment access, blocked-sender insert prevention, immutable attachments, authenticated-only key reads).
- `user-lookup` and account-deletion edge functions **JWT-scoped**.
- Attachment **type/size/expiry** validation; client **rate-limiting**; input validation; self-conversation guard.
- Login password held in `sessionStorage` only until key setup completes (window minimized).
- Account **nuke** (full delete) + **lost-recovery-key re-key** (no admin backdoor).

## Roadmap — not yet implemented

1. **Forward secrecy / post-compromise security (Double Ratchet).** Today's protocol
   is static-static ECDH (one session key per pair, epoch 0), so an identity-key
   compromise decrypts all past/future messages for that pair. The proper fix is
   X3DH + Double Ratchet. This is a substantial, async-correctness-heavy change
   (out-of-order + skipped-message keys, deterministic history re-decrypt,
   multi-device) and **must be built incrementally with real send/receive testing**,
   or by adopting a **vetted library** (e.g. libsignal) rather than a bespoke
   from-scratch implementation. Tracked as the top remaining item; an unverified
   blind implementation was deliberately NOT shipped.
2. CSP still allows `'unsafe-inline'` for scripts (the pages use inline handlers/
   blocks); removing it requires extracting inline scripts to files or nonces.
3. Minor: cosmetic internal `moneyTracker*` config/global renames.

See `docs/SECURITY_REVIEW.md` for the finding-by-finding detail and severities.
