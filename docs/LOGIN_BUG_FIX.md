# Login Bug Fix — recovery key requested on every same-device login

## Symptom

A returning user on the **same device (Safari)**, entering the **correct password**,
is asked for the 24-word recovery key on **every** login. Expected: the local
identity key loads and the user is redirected silently, with no recovery key ever
needed on the same device.

This is a regression from the Phase C E2E hardening (`75d3a31`):

- **SM-02** wrapped the identity secret at rest (AES-GCM under a non-extractable
  `CryptoKey` held in a new `wrap_keys` IndexedDB store) and added a clean-break
  disposal of the legacy v1 *plaintext* identity record.
- The IndexedDB version was bumped **v1 → v2** to create `wrap_keys`,
  `pinned_keys`, `recv_counters`.

## Root cause (confirmed by reading the full path)

The recovery prompt at `auth/views/auth.html` only appears when **both** of these
are true in `handlePostSignIn()`:

1. `KeyStorageService.getIdentityKeys(userId)` does **not** return usable keys, and
2. `KeyManagementService.restoreFromPassword(password)` throws something other than
   "No password backup found".

Two independent defects pushed a same-device user into that state on **every**
login:

### Defect A — `initialize()` wiped a valid local key on a benign server difference (dominant cause)

`KeyManagementService.initialize()` compared the local public key to the server's
published `identity_keys.public_key` and, on **any** difference, did:

```js
} else if (localPublicKeyB64 !== dbPublicKey) {
    console.log('Key mismatch, clearing invalid local keys');
    await KeyStorageService.clearAll();          // <-- destroys the local identity
    if (hasBackup) return { needsRestore: true, ... };
    ...
}
```

On the same device the **local** (successfully-unwrapped) private key is the source
of truth — it is the half we actually encrypt with. A difference vs the server's
*published* public key is almost always benign server lag: after the v1→v2
clean-break disposal + password restore, `restoreFromPassword` rederives the public
key from the password backup, but the server `identity_keys` row may still hold a
stale/old public key. That benign drift made `localPublicKeyB64 !== dbPublicKey`
true, so `initialize()` **cleared the freshly-restored local key** and returned
`needsRestore` — every single login. `clearAll()` correctly preserves `wrap_keys`,
so the wipe never "settled"; it just re-ran forever, demanding restore each time.

### Defect B — `getIdentityKeys()` could not distinguish "no key" from "key present but unreadable"

`getIdentityKeys()` returned `null` for a genuinely absent record **and** would
`throw` an `OperationError` from `crypto.subtle.decrypt` if the stored
`wrappedSecret` could not be unwrapped (wrap key regenerated, or — on Safari, whose
ITP/storage eviction can drop IndexedDB CryptoKey material independently — the
`wrap_keys` entry was evicted while the wrapped `identity_keys` record survived).
In `handlePostSignIn()` that throw propagated to the outer `catch`, which
**signed the user out**; in `initialize()` it was swallowed into a generic
`{ success:false, error }`. Either way a same-device user *with a real local
identity* was treated as having no keys and pushed toward restore/recovery, with no
deterministic, non-destructive handling of the present-but-unreadable case.

(Candidate causes from the brief that were **eliminated**: `clearAll` *does*
preserve `wrap_keys` — `keyStorageService.js` line ~752 excludes it from the cleared
list. The DB version source *is* v2 in both config files, so a fresh DB does create
`wrap_keys`. `storeIdentityKeys` *is* reached during restore. The actual triggers
are A and B above, not those.)

## The fix (minimal, security-preserving)

Edited only `encryption/**` and `auth/views/auth.html`. No weakening of at-rest
protection or TOFU; no return to plaintext storage.

### 1. `encryption/services/keyStorageService.js`

- `getIdentityKeys()` now treats a **present** wrapped record distinctly: if the
  wrap key is unavailable it throws `WRAP_KEY_UNAVAILABLE`; if the wrapped secret
  cannot be decrypted it throws `IDENTITY_UNWRAP_FAILED`. It **no longer collapses
  "unreadable" into `null`**, and it **does not `clearAll()`** a present record on
  unwrap failure (wiping a present-but-unreadable record was what made the loop
  permanent). A genuinely absent record / legacy plaintext record / record missing
  the wrapped fields still returns `null` exactly as before.
- Added `hasWrappedIdentity(userId)` so callers can tell "this device has a local
  identity (be careful before wiping)" apart from "no local identity".

### 2. `encryption/services/keyManagementService.js` — `initialize()`

- The `getIdentityKeys()` call is wrapped: an `IDENTITY_UNWRAP_FAILED` /
  `WRAP_KEY_UNAVAILABLE` result returns `{ success:false, identityUnreadable:true,
  needsRestore: hasBackup, hasBackup }` **without wiping** the local record.
- The local-vs-server public-key branch **no longer wipes** local on a difference.
  Because the successfully-unwrapped local private key is authoritative on the same
  device, a difference now **re-uploads (re-publishes) the local public key to the
  server** (`_uploadPublicKeyToServer`) and continues silently. The destructive
  `clearAll()` + `needsRestore` + fresh-key-generation path is removed from the
  benign-difference case.

### 3. `auth/views/auth.html` — `handlePostSignIn()`

- The `getIdentityKeys()` call is wrapped in try/catch. On
  `IDENTITY_UNWRAP_FAILED` / `WRAP_KEY_UNAVAILABLE` it does **not** sign the user
  out and does **not** jump to the recovery-key screen; it falls through to the
  existing password-backup restore path, which re-establishes a usable wrapped
  record for next session. Any other error still propagates.

## Why a same-device login now avoids the recovery prompt

- **Normal returning login:** `getIdentityKeys()` unwraps the stored secret and
  returns keys → `handlePostSignIn()` redirects silently. `initialize()` is not
  even reached for the redirect, and even if reached, a stale server public key now
  triggers a **re-upload of the local key**, never a wipe. No restore, no recovery
  prompt.
- **First login after the v1→v2 upgrade:** the legacy plaintext record is disposed
  once (returns `null`), password restore stores a properly **wrapped** record, and
  every subsequent login takes the normal silent path — instead of looping because
  `initialize()` re-wiped on a benign server difference.
- **Safari evicted the wrap key (rare):** `getIdentityKeys()` throws a typed
  `WRAP_KEY_UNAVAILABLE`/`IDENTITY_UNWRAP_FAILED` instead of signing the user out;
  the cached password silently restores from backup and re-wraps under the current
  wrap key, so the user still does not see the 24-word prompt.

## Security preserved

- The identity secret is still stored **only** as AES-GCM ciphertext under the
  non-extractable wrap key; no plaintext path was reintroduced.
- TOFU pinning (`_getPinnedPeerKey`) is untouched.
- We never *suppress* a genuine cryptographic failure: unwrap failures are surfaced
  as typed errors, and the local key is treated as authoritative on the device that
  holds it — re-publishing the public key is strictly a self-heal of public
  (non-secret) state, never a secret disclosure or a downgrade.

## Verification

`node --check` passes for all changed files:

- `encryption/services/keyStorageService.js` — OK
- `encryption/services/keyManagementService.js` — OK
- `auth/views/auth.html` (inline `<script>` blocks extracted) — OK
