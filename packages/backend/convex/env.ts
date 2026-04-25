type EnvError = {
  name: string;
  reason: string;
};

function isPlaceholderValue(value: string): boolean {
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

function readRequiredEnv(
  name: string,
  errors: EnvError[],
  opts?: {
    validate?: (value: string) => string | null;
  },
): string {
  const raw = process.env[name];
  const value = raw?.trim() ?? "";

  if (!value) {
    errors.push({ name, reason: "missing or empty" });
    return "";
  }

  if (isPlaceholderValue(value)) {
    errors.push({ name, reason: "placeholder/example value is not allowed" });
    return "";
  }

  const reason = opts?.validate?.(value);
  if (reason) {
    errors.push({ name, reason });
    return "";
  }

  return value;
}

function readOptionalEnv(
  name: string,
  errors: EnvError[],
  opts?: {
    validate?: (value: string) => string | null;
  },
): string | undefined {
  const value = process.env[name]?.trim();
  if (!value) return undefined;

  if (isPlaceholderValue(value)) {
    errors.push({ name, reason: "placeholder/example value is not allowed" });
    return undefined;
  }

  const reason = opts?.validate?.(value);
  if (reason) {
    errors.push({ name, reason });
    return undefined;
  }

  return value;
}

function validateHttpsUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      return "must be an https URL";
    }
    return null;
  } catch {
    return "must be a valid URL";
  }
}

function validateClerkWebhookSecret(value: string): string | null {
  if (!value.startsWith("whsec_")) {
    return "must start with 'whsec_'";
  }
  return null;
}

function validateOpenAiApiKey(value: string): string | null {
  if (!value.startsWith("sk-")) {
    return "must start with 'sk-'";
  }
  return null;
}

function parseOpenAiApiKeyRotation(
  raw: string | undefined,
  errors: EnvError[],
): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      if (isPlaceholderValue(value)) {
        errors.push({
          name: "OPENAI_API_KEYS",
          reason: `contains placeholder value '${value}'`,
        });
        return false;
      }
      const reason = validateOpenAiApiKey(value);
      if (reason) {
        errors.push({ name: "OPENAI_API_KEYS", reason });
        return false;
      }
      return true;
    });
}

function parseBootstrapAdminIds(
  raw: string | undefined,
  errors: EnvError[],
): string[] {
  if (!raw) return [];

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      if (isPlaceholderValue(value)) {
        errors.push({
          name: "ADMIN_BOOTSTRAP_CLERK_USER_IDS",
          reason: `contains placeholder id '${value}'`,
        });
        return false;
      }
      return true;
    });
}

function isProductionEnvironment(): boolean {
  const candidates = [
    process.env.DAYLOG_APP_ENV,
    process.env.APP_ENV,
    process.env.DEPLOY_ENV,
    process.env.VERCEL_ENV,
    process.env.NODE_ENV,
  ];

  return candidates.some((value) => {
    const normalized = value?.trim().toLowerCase();
    return normalized === "production" || normalized === "prod";
  });
}

function failIfInvalid(scope: string, errors: EnvError[]): void {
  if (errors.length === 0) return;

  const formatted = errors
    .map((err) => `- ${err.name}: ${err.reason}`)
    .join("\n");
  throw new Error(
    `[env:${scope}] Invalid server environment configuration.\n${formatted}`,
  );
}

export type ConvexServerEnv = {
  clerkJwtIssuerDomain: string;
  clerkWebhookSecret: string;
  exportSigningSecret?: string;
  openAiApiKey: string;
  openAiApiKeyRotation: string[];
  aiGatewayBaseUrl?: string;
  aiGatewayApiKey?: string;
  adminBootstrapClerkUserIds: string[];
};

function validateConvexServerEnv(): ConvexServerEnv {
  const errors: EnvError[] = [];

  const clerkJwtIssuerDomain = readRequiredEnv(
    "CLERK_JWT_ISSUER_DOMAIN",
    errors,
    { validate: validateHttpsUrl },
  );

  const clerkWebhookSecret = readRequiredEnv("CLERK_WEBHOOK_SECRET", errors, {
    validate: validateClerkWebhookSecret,
  });

  const exportSigningSecret = readOptionalEnv("EXPORT_SIGNING_SECRET", errors);
  if (isProductionEnvironment() && !exportSigningSecret) {
    errors.push({
      name: "EXPORT_SIGNING_SECRET",
      reason: "required in production",
    });
  }

  const openAiApiKey = readRequiredEnv("OPENAI_API_KEY", errors, {
    validate: validateOpenAiApiKey,
  });

  const openAiApiKeyRotationRaw = readOptionalEnv("OPENAI_API_KEYS", errors);
  const openAiApiKeyRotation = parseOpenAiApiKeyRotation(
    openAiApiKeyRotationRaw,
    errors,
  );

  const aiGatewayBaseUrl = readOptionalEnv("AI_GATEWAY_BASE_URL", errors, {
    validate: validateHttpsUrl,
  });
  const aiGatewayApiKey = readOptionalEnv("AI_GATEWAY_API_KEY", errors);

  const adminBootstrapRaw = readOptionalEnv(
    "ADMIN_BOOTSTRAP_CLERK_USER_IDS",
    errors,
  );
  const adminBootstrapClerkUserIds = parseBootstrapAdminIds(
    adminBootstrapRaw,
    errors,
  );

  failIfInvalid("convex", errors);

  return {
    clerkJwtIssuerDomain,
    clerkWebhookSecret,
    exportSigningSecret,
    openAiApiKey,
    openAiApiKeyRotation,
    aiGatewayBaseUrl,
    aiGatewayApiKey,
    adminBootstrapClerkUserIds,
  };
}

export const convexServerEnv = validateConvexServerEnv();
