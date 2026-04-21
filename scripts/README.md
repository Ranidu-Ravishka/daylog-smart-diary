# Generate and manage secret key material

This folder contains small helper scripts for generating and managing secret key material used by the backend integration secrets keyring.

## generate-key.mjs

Generates a secure 32-byte (256-bit) random key encoded in base64 suitable for use as an AES-256 key in `INTEGRATION_SECRETS_KEYRING_JSON`.

Usage:

```bash
node scripts/generate-key.mjs
# Output: base64-string
```

Example keyring JSON (do NOT commit):

```json
{
  "key-v1": "<base64-encoded-32-byte-key>",
  "key-v2": "<base64-encoded-32-byte-key>"
}
```

## Recommended steps for key rotation

1. Generate new key with `node scripts/generate-key.mjs`.
2. Update `INTEGRATION_SECRETS_KEYRING_JSON` secret in GitHub with the new key added alongside existing keys.
3. Update `INTEGRATION_SECRETS_ACTIVE_KEY_ID` to the new key id.
4. Run the backend key rotation/migration job (if provided) to re-encrypt existing secrets with the new key.
