import qrcode from "qrcode-generator";

const MAX_PROVISIONING_URI_LENGTH = 2048;
const BASE32_SECRET = /^[A-Z2-7]{16,128}={0,6}$/;
const ALLOWED_QUERY_KEYS = new Set(["secret", "issuer", "algorithm", "digits", "period"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function isSafeTotpProvisioningUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_PROVISIONING_URI_LENGTH) {
    return false;
  }

  try {
    const uri = new URL(value);
    const keys = [...uri.searchParams.keys()];
    if (keys.some((key) => !ALLOWED_QUERY_KEYS.has(key))) return false;
    if ([...ALLOWED_QUERY_KEYS].some((key) => uri.searchParams.getAll(key).length !== 1)) return false;

    const secret = uri.searchParams.get("secret") ?? "";
    const issuer = uri.searchParams.get("issuer") ?? "";
    const label = decodeURIComponent(uri.pathname.slice(1));
    return uri.protocol === "otpauth:"
      && uri.hostname.toLowerCase() === "totp"
      && uri.port === ""
      && uri.hash === ""
      && label.length > issuer.length + 1
      && label.length <= 160
      && issuer.length > 0
      && issuer.length <= 64
      && !CONTROL_CHARACTERS.test(label)
      && !CONTROL_CHARACTERS.test(issuer)
      && label.startsWith(`${issuer}:`)
      && BASE32_SECRET.test(secret)
      && uri.searchParams.get("algorithm") === "SHA1"
      && uri.searchParams.get("digits") === "6"
      && uri.searchParams.get("period") === "30";
  } catch {
    return false;
  }
}

export function createTotpEnrollmentQrDataUrl(provisioningUri: unknown): string | null {
  if (!isSafeTotpProvisioningUri(provisioningUri)) return null;

  try {
    const qr = qrcode(0, "M");
    qr.addData(provisioningUri, "Byte");
    qr.make();
    return qr.createDataURL(5, 20);
  } catch {
    return null;
  }
}

export function validatedManualTotpKey(provisioningUri: unknown, manualKey: unknown): string | null {
  if (typeof manualKey !== "string") return null;
  const normalizedKey = manualKey.trim();
  if (!BASE32_SECRET.test(normalizedKey)) return null;

  if (typeof provisioningUri !== "string" || provisioningUri.trim().length === 0) {
    return normalizedKey;
  }
  if (!isSafeTotpProvisioningUri(provisioningUri)) return null;

  return new URL(provisioningUri).searchParams.get("secret") === normalizedKey
    ? normalizedKey
    : null;
}
