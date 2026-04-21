#!/usr/bin/env node
// Generate a secure 32-byte (256-bit) random key encoded in base64
// Usage: node scripts/generate-key.mjs

async function generate() {
  let buf;
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    buf = Buffer.from(arr);
  } else {
    // Node fallback
    const { randomBytes } = await import('node:crypto');
    buf = randomBytes(32);
  }
  return buf.toString('base64');
}

(async () => {
  try {
    const key = await generate();
    console.log(key);
  } catch (err) {
    console.error('Failed to generate key:', err && err.message ? err.message : String(err));
    process.exit(1);
  }
})();
