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

function validateClerkSecretKey(value: string): string | null {
  if (!(value.startsWith("sk_test_") || value.startsWith("sk_live_"))) {
    return "must start with 'sk_test_' or 'sk_live_'";
  }
  return null;
}

function failIfInvalid(errors: EnvError[]): void {
  if (errors.length === 0) return;

  const formatted = errors
    .map((err) => `- ${err.name}: ${err.reason}`)
    .join("\n");
  throw new Error(
    `[env:admin] Invalid server environment configuration.\n${formatted}`,
  );
}

export type AdminServerEnv = {
  clerkSecretKey: string;
  convexUrl: string;
};

function validateAdminServerEnv(): AdminServerEnv {
  const errors: EnvError[] = [];

  const clerkSecretKey = readRequiredEnv("CLERK_SECRET_KEY", errors, {
    validate: validateClerkSecretKey,
  });

  const convexUrl = readRequiredEnv("NEXT_PUBLIC_CONVEX_URL", errors, {
    validate: validateHttpsUrl,
  });

  failIfInvalid(errors);

  return {
    clerkSecretKey,
    convexUrl,
  };
}

export const adminServerEnv = validateAdminServerEnv();
