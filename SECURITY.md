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

## Known weaknesses being addressed

These are tracked in `docs/SECURITY_REVIEW.md` with remediation status:

1. Crypto library is loaded from a CDN without Subresource Integrity (supply-chain risk).
2. Identity secret key is stored unencrypted at rest in IndexedDB.
3. The login password is briefly held in `sessionStorage` to drive key backup.
4. Verbose logging can print key material in development builds.
5. No server-side public-key authenticity pinning (TOFU) — MITM by a malicious server.
6. Forward secrecy is limited (static-static ECDH; no double-ratchet) and key rotation
   is currently disabled.
7. No Content-Security-Policy is set on the pages.

See the review document for the full list, severities, and fixes.
