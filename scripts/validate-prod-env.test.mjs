import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateIntegrationKeyring,
  validateConvexServerEnv,
} from './validate-prod-env.mjs';

test('validateIntegrationKeyring accepts valid keyring', () => {
  const key = Buffer.alloc(32, 0x42).toString('base64');
  const json = JSON.stringify({ k1: key });
  const result = validateIntegrationKeyring(json);
  assert.deepEqual(result.keys, ['k1']);
});

test('validateIntegrationKeyring rejects wrong-length key', () => {
  const key = Buffer.alloc(16, 0x42).toString('base64');
  const json = JSON.stringify({ k1: key });
  let thrown = false;
  try {
    validateIntegrationKeyring(json);
  } catch (err) {
    thrown = true;
    assert.match(String(err), /must decode to 32 bytes/);
  }
  assert.ok(thrown, 'expected validation to throw for wrong-length key');
});

test('validateConvexServerEnv accepts valid envs (local)', () => {
  const env = {
    CLERK_JWT_ISSUER_DOMAIN: 'https://localhost',
    CLERK_WEBHOOK_SECRET: 'whsec_abcdefghijklmnopqrstuvwxyz',
    OPENAI_API_KEY: 'sk-testkey',
    NODE_ENV: 'development',
  };

  const { errors, warnings } = validateConvexServerEnv(env, { mode: 'local' });
  assert.equal(errors.length, 0, `unexpected errors: ${errors.join(',')}`);
  assert.ok(Array.isArray(warnings));
});
