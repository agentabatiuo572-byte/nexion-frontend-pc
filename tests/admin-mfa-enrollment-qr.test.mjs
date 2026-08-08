import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import jsQR from "jsqr";
import omggif from "omggif";

import {
  createTotpEnrollmentQrDataUrl,
  isSafeTotpProvisioningUri,
  validatedManualTotpKey,
} from "../lib/admin/mfa-enrollment-qr.ts";

const validUri = "otpauth://totp/Nexion%3Asuperadmin?secret=JBSWY3DPEHPK3PXP&issuer=Nexion&algorithm=SHA1&digits=6&period=30";

test("only a bounded TOTP provisioning URI with a base32 secret can be rendered", () => {
  assert.equal(isSafeTotpProvisioningUri(validUri), true);
  assert.equal(isSafeTotpProvisioningUri("https://example.com/qr?secret=JBSWY3DPEHPK3PXP"), false);
  assert.equal(isSafeTotpProvisioningUri("otpauth://hotp/Nexion%3Asuperadmin?secret=JBSWY3DPEHPK3PXP&counter=0"), false);
  assert.equal(isSafeTotpProvisioningUri("otpauth://totp/Nexion%3Asuperadmin?issuer=Nexion"), false);
  assert.equal(isSafeTotpProvisioningUri("otpauth://totp/Nexion%3Asuperadmin?secret=not-a-base32-secret"), false);
  assert.equal(isSafeTotpProvisioningUri(`${validUri}&secret=AAAAAAAAAAAAAAAA`), false);
  assert.equal(isSafeTotpProvisioningUri(`${validUri}&digits=8`), false);
  assert.equal(isSafeTotpProvisioningUri(`${validUri}&image=https%3A%2F%2Fexample.com%2Flogo.png`), false);
  assert.equal(isSafeTotpProvisioningUri(validUri.replace("issuer=Nexion", "issuer=Other")), false);
  assert.equal(isSafeTotpProvisioningUri(`otpauth://totp/${"x".repeat(4096)}?secret=JBSWY3DPEHPK3PXP`), false);
});

test("QR rendering is local and fails closed for invalid input", () => {
  const dataUrl = createTotpEnrollmentQrDataUrl(validUri) ?? "";
  assert.match(dataUrl, /^data:image\/gif;base64,/);
  const gifBytes = Buffer.from(dataUrl.split(",", 2)[1], "base64");
  const reader = new omggif.GifReader(gifBytes);
  const pixels = new Uint8ClampedArray(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(0, pixels);
  const decoded = jsQR(pixels, reader.width, reader.height);
  assert.equal(decoded?.data, validUri, "an independent decoder must recover the exact provisioning URI");
  assert.equal(createTotpEnrollmentQrDataUrl("https://example.com/qr"), null);
});

test("manual fallback is normalized, base32-valid, and consistent with the QR secret", () => {
  assert.equal(validatedManualTotpKey(validUri, "  JBSWY3DPEHPK3PXP  "), "JBSWY3DPEHPK3PXP");
  assert.equal(validatedManualTotpKey(validUri, "   "), null);
  assert.equal(validatedManualTotpKey(validUri, "not-a-base32-secret"), null);
  assert.equal(validatedManualTotpKey(validUri, "AAAAAAAAAAAAAAAA"), null);
  assert.equal(validatedManualTotpKey(undefined, "JBSWY3DPEHPK3PXP"), "JBSWY3DPEHPK3PXP");
  assert.equal(validatedManualTotpKey("https://example.com/qr", "JBSWY3DPEHPK3PXP"), null);
});

test("the enrollment screen keeps a manual-key fallback and never calls a remote QR service", () => {
  const source = readFileSync(join(process.cwd(), "app/components/shell/login-gate.tsx"), "utf8");
  const renderer = readFileSync(join(process.cwd(), "lib/admin/mfa-enrollment-qr.ts"), "utf8");

  assert.match(source, /createTotpEnrollmentQrDataUrl/);
  assert.match(source, /mfaChallenge\?\.mode === "ENROLL"/);
  assert.match(source, /mfaChallenge\.provisioningUri/);
  assert.match(source, /alt="Google Authenticator 绑定二维码"/);
  assert.match(source, /validatedManualTotpKey/);
  assert.match(source, /无法生成绑定信息/);
  assert.match(source, /返回登录重新获取/);
  assert.doesNotMatch(source, /api\.qrserver|chart\.googleapis|quickchart|qrcode\.tec-it/i);
  assert.match(renderer, /createDataURL\(5, 20\)/, "normal QR codes need a four-module quiet zone");
});
