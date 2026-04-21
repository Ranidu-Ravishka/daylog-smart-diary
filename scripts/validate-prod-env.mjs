#!/usr/bin/env node
// Validate production environment variables for DayLog (Convex + Node + React monorepo)
// Exports reusable validation functions and provides a CLI entrypoint.

function isPlaceholderValue(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return true;
  const exactPlaceholders = new Set([
    "changeme",
    "replace-me",
    "replace_this",
    "replace_this_value",
    "todo",
    "tbd",
  ]);
  if (exactPlaceholders.has(normalized)) return true;
  return ["your_", "your-", "your ", "<", "example", "placeholder", "xxx"].some(
    (token) => normalized.includes(token),
  );
}

function parseJsonEnv(name, raw) {
  if (typeof raw !== "string") {
    throw new Error(`${name} must be set`);
  }

  const trimmed = raw.trim();
  if (!trimmed) throw new Error(`${name} must be a non-empty JSON string`);

  try {
    const parsed = JSON.parse(trimmed);
    return parsed;
  } catch (err) {
    throw new Error(`${name} contains invalid JSON: ${err.message}`);
  }
}

function validateIntegrationKeyring(rawJsonString) {
  const name = "INTEGRATION_SECRETS_KEYRING_JSON";
  const errors = [];
  let parsed;

  try {
    parsed = parseJsonEnv(name, rawJsonString);
  } catch (err) {
    throw err;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object mapping key ids to base64 keys`);
  }

  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw new Error(`${name} must contain at least one key entry`);
  }

  const AES_KEY_BYTES = 32;

  for (const [keyId, keyMaterial] of entries) {
    if (typeof keyId !== "string" || !keyId.trim()) {
      errors.push(`invalid key id: ${String(keyId)}`);
      continue;
    }

    if (typeof keyMaterial !== "string") {
      errors.push(`key '${keyId}' value must be a base64 string`);
      continue;
    }

    const trimmed = keyMaterial.trim();
    if (!trimmed) {
      errors.push(`key '${keyId}' value is empty`);
      continue;
    }

    let decoded;
    try {
      decoded = Buffer.from(trimmed, "base64");
    } catch (err) {
      errors.push(`key '${keyId}' is not valid base64`);
      continue;
    }

    if (decoded.length !== AES_KEY_BYTES) {
      errors.push(`key '${keyId}' must decode to ${AES_KEY_BYTES} bytes, got ${decoded.length}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`${name} validation errors:\n  - ${errors.join("\n  - ")}`);
  }

  return { valid: true, keys: Object.keys(parsed) };
}

function validateConvexServerEnv(env = process.env, options = {}) {
  const errors = [];
  const warnings = [];

  function readRequired(name, validator) {
    const raw = env[name];
    if (!raw) {
      errors.push(`${name} is required and missing`);
      return null;
    }
    if (isPlaceholderValue(raw)) {
      errors.push(`${name} appears to be a placeholder/example value`);
      return null;
    }
    if (validator) {
      const reason = validator(raw);
      if (reason) errors.push(`${name} invalid: ${reason}`);
    }
    return raw;
  }

  function readOptional(name, validator) {
    const raw = env[name];
    if (!raw) return undefined;
    if (isPlaceholderValue(raw)) {
      warnings.push(`${name} appears to be a placeholder/example value`);
      return undefined;
    }
    if (validator) {
      const reason = validator(raw);
      if (reason) {
        warnings.push(`${name} invalid: ${reason}`);
      }
    }
    return raw;
  }

  const validateHttpsUrl = (value) => {
    try {
      const u = new URL(value);
      if (u.protocol !== "https:") return "must be an https URL";
      return null;
    } catch {
      return "must be a valid URL";
    }
  };

  const validateClerkWebhookSecret = (value) => {
    if (!value.startsWith("whsec_")) return "must start with 'whsec_'";
    return null;
  };

  const validateOpenAiApiKey = (value) => {
    if (!value.startsWith("sk-")) return "must start with 'sk-'";
    return null;
  };

  // Required in production/ci mode
  readRequired("CLERK_JWT_ISSUER_DOMAIN", validateHttpsUrl);
  readRequired("CLERK_WEBHOOK_SECRET", validateClerkWebhookSecret);
  readRequired("OPENAI_API_KEY", validateOpenAiApiKey);

  // Export signing secret is required in production environments (when NODE_ENV=production)
  const isProd = (env.NODE_ENV || "").toLowerCase() === "production" || options.mode === "ci";
  if (isProd) {
    readRequired("EXPORT_SIGNING_SECRET");
  } else {
    readOptional("EXPORT_SIGNING_SECRET");
  }

  return { errors, warnings };
}

async function runCli() {
  const argv = process.argv.slice(2);
  const modeArg = argv.find((a) => a.startsWith("--mode="));
  const mode = modeArg ? modeArg.split("=")[1] : process.env.CI ? "ci" : "local";

  const strict = mode === "ci" || mode === "production";

  console.log(`validate-prod-env: running in mode=${mode}`);

  const failures = [];

  // 1) Validate convex server env
  try {
    const { errors, warnings } = validateConvexServerEnv(process.env, { mode });
    if (errors.length > 0) {
      failures.push(...errors.map((e) => `ConvexEnv: ${e}`));
    }
    for (const w of warnings) console.warn(`WARN: ${w}`);
  } catch (err) {
    failures.push(`ConvexEnv: ${err.message}`);
  }

  // 2) Validate integration keyring if provided or required in strict mode
  const keyringRaw = process.env.INTEGRATION_SECRETS_KEYRING_JSON;
  const activeKeyId = process.env.INTEGRATION_SECRETS_ACTIVE_KEY_ID;

  if (strict) {
    if (!keyringRaw) failures.push("INTEGRATION_SECRETS_KEYRING_JSON is required in CI/production mode");
    if (!activeKeyId) failures.push("INTEGRATION_SECRETS_ACTIVE_KEY_ID is required in CI/production mode");
  }

  if (keyringRaw) {
    try {
      const { keys } = validateIntegrationKeyring(keyringRaw);
      if (activeKeyId && !keys.includes(activeKeyId)) {
        failures.push(`INTEGRATION_SECRETS_ACTIVE_KEY_ID='${activeKeyId}' not found in INTEGRATION_SECRETS_KEYRING_JSON keys`);
      }
    } catch (err) {
      failures.push(err.message);
    }
  } else if (activeKeyId) {
    failures.push("INTEGRATION_SECRETS_ACTIVE_KEY_ID is set but INTEGRATION_SECRETS_KEYRING_JSON is empty or missing");
  }

  if (failures.length > 0) {
    console.error("ENV VALIDATION FAILED:");
    for (const f of failures) console.error(` - ${f}`);
    process.exit(1);
  }

  console.log("ENV VALIDATION SUCCEEDED");
  process.exit(0);
}

// Exports for reuse by CI or other scripts
export { isPlaceholderValue, parseJsonEnv, validateIntegrationKeyring, validateConvexServerEnv };

if (process.argv[1] && process.argv[1].endsWith("validate-prod-env.mjs")) {
  runCli().catch((err) => {
    console.error(`Unexpected error: ${err && err.message ? err.message : String(err)}`);
    process.exit(2);
  });
}
