import assert from "node:assert/strict";
import test from "node:test";
import {
  brandingManifest,
  DEFAULT_BRANDING,
  parseBranding,
  validateBrandName,
  validateLogoFile,
} from "../src/lib/branding.ts";

test("brand names accept 12 Unicode characters, trim spaces and reject blank, long or control text", () => {
  assert.equal(validateBrandName("  Minha Marca  "), "Minha Marca");
  assert.equal(validateBrandName("123456789012"), "123456789012");
  assert.equal(validateBrandName("😀".repeat(12)), "😀".repeat(12));
  for (const value of ["", "   ", "1234567890123", "abc\ndef", "a\u0000b"])
    assert.throws(() => validateBrandName(value));
});

test("logos must be square raster images within the supported size limits", () => {
  for (const type of ["image/png", "image/jpeg", "image/webp"])
    assert.doesNotThrow(() => validateLogoFile(type, 1024, 512, 512));
  for (const args of [
    ["image/svg+xml", 100, 512, 512],
    ["image/png", 0, 512, 512],
    ["image/png", 6 * 1024 * 1024, 512, 512],
    ["image/png", 100, 512, 256],
    ["image/png", 100, 16, 16],
    ["image/png", 100, 9000, 9000],
  ] as const)
    assert.throws(() => validateLogoFile(...args));
});

test("untrusted public identity cannot insert a remote or SVG logo", () => {
  assert.deepEqual(parseBranding(null), DEFAULT_BRANDING);
  assert.equal(
    parseBranding({ name: "Marca", logo: "https://outside.invalid/track.png" }).logo,
    null,
  );
  assert.equal(parseBranding({ name: "Marca", logo: "data:image/svg+xml,<svg/>" }).logo, null);
  assert.deepEqual(parseBranding({ name: "x".repeat(13) }), DEFAULT_BRANDING);
});

test("installed app uses the chosen name and one versioned square icon", () => {
  const manifest = brandingManifest({ name: "Meu CRM", logo: null, revision: "2026-10-30 01:00" });
  assert.equal(manifest.name, "Meu CRM");
  assert.equal(manifest.short_name, "Meu CRM");
  assert.equal(manifest.icons[0].sizes, "512x512");
  assert.match(manifest.icons[0].src, /^\/app-icon\.png\?v=2026-10-30%2001%3A00$/);
});
