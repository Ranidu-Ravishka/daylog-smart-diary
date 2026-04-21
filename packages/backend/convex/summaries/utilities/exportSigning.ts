function isProductionEnvironment(): boolean {
  const envCandidates = [
    process.env.DAYLOG_APP_ENV,
    process.env.APP_ENV,
    process.env.DEPLOY_ENV,
    process.env.VERCEL_ENV,
    process.env.NODE_ENV,
  ];

  return envCandidates.some((value) => {
    const normalized = value?.trim().toLowerCase();
    return normalized === "production" || normalized === "prod";
  });
}

export function ensureExportSigningSecretConfiguredInProduction(): void {
  if (!isProductionEnvironment()) {
    return;
  }

  if (process.env.EXPORT_SIGNING_SECRET?.trim()) {
    return;
  }

  throw new Error(
    "Missing export signing secret in production. Configure EXPORT_SIGNING_SECRET.",
  );
}

function getExportSigningSecret(): string {
  const exportSigningSecret = process.env.EXPORT_SIGNING_SECRET?.trim();
  if (exportSigningSecret) {
    return exportSigningSecret;
  }

  throw new Error(
    "Missing export signing secret. Configure EXPORT_SIGNING_SECRET.",
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeHmacSha256Hex(
  payloadText: string,
): Promise<string> {
  const signerKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(getExportSigningSecret()),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const encodedPayload = new TextEncoder().encode(payloadText);
  const signature = await crypto.subtle.sign("HMAC", signerKey, encodedPayload);

  return toHex(new Uint8Array(signature));
}

export function signaturesEqual(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
