import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = read("lib/admin/a4-client.ts");
const page = read("app/components/domain-views/a-tabs/a4-events.tsx");
const proxy = read("app/api/admin/platform/[...path]/route.ts");

test("A4 renders each server-returned current schema with an authority-gated property extension action", () => {
  assert.match(page, /SCHEMA_REGISTRATIONS\.map/);
  assert.match(page, /schema\.properties/);
  assert.match(page, /schema\.version/);
  assert.match(page, /openSchemaPropertyExtension\(schema\)/);
  assert.match(page, /disabled=\{!canWrite \|\| !!mutating \|\| !!loadError\}/);
  assert.doesNotMatch(page, /quest\.completed[\s\S]{0,160}openSchemaPropertyExtension/);
});

test("A4 property extension freezes the global registry CAS version instead of an event registration version", () => {
  const eventRegistrationVersion = "v104";
  const globalRegistryVersion = "v316";
  assert.notEqual(eventRegistrationVersion, globalRegistryVersion, "the two version domains must not be conflated");
  assert.match(page, /kind: "multi-field"/);
  assert.match(page, /key: "propertyName"/);
  assert.match(page, /key: "propertyType"/);
  assert.match(page, /const registryVersion = overview\?\.stats\.schemaVersion \?\? ""/);
  assert.match(page, /事件登记版本/);
  assert.match(page, /全局注册表 CAS 版本/);
  assert.match(page, /addA4SchemaProperty\(schemaSnapshot\.eventName, propertyName, propertyType, registryVersion, reason, stableKey\)/);
  assert.doesNotMatch(page, /addA4SchemaProperty\(schemaSnapshot\.eventName, propertyName, propertyType, schemaSnapshot\.version, reason, stableKey\)/);
  assert.match(client, /export async function addA4SchemaProperty/);
  assert.match(client, /\^v\[1-9\]\[0-9\]\*\$/);
  assert.match(client, /body: JSON\.stringify\(\{ eventName, propertyName, propertyType, expectedVersion, reason \}\)/);
  const start = client.indexOf("export async function addA4SchemaProperty");
  const end = client.indexOf("export async function registerA4DomainExtension", start);
  assert.ok(start >= 0 && end > start, "property extension client slice is present");
  assert.doesNotMatch(client.slice(start, end), /(?:producer|ownerDomain|consumer|samplingPolicy|serverAuthoritative)\s*:/);
});

test("A4 proxy exposes only the exact existing-schema property extension route", () => {
  assert.match(proxy, /parts\.length === 3 && parts\[0\] === "events" && parts\[1\] === "schema-registrations" && parts\[2\] === "properties"/);
  assert.match(proxy, /return "\/api\/admin\/platform\/events\/schema-registrations\/properties"/);
});

test("A4 can preview one existing schema outside the overview cutoff without a collection search", () => {
  assert.match(client, /export async function fetchA4SchemaRegistration\(eventName: string\)/);
  assert.match(client, /`\/events\/schema-registrations\/\$\{encodeURIComponent\(eventName\)\}`/);
  assert.match(proxy, /parts\.length === 3 && parts\[0\] === "events" && parts\[1\] === "schema-registrations"\s*&& isNonEmpty\(parts\[2\]\)/);
  assert.match(page, /schemaLookupSequence/);
  assert.match(page, /fetchA4SchemaRegistration\(requestedEventName\)/);
  assert.match(page, /found\.eventName !== requestedEventName/);
  assert.match(page, /查询既有 Schema/);
});

test("A4 treats a schema with no custom properties as a valid first-property target", () => {
  assert.match(client, /textOrFallback\(row\.properties, "schemaRegistrations\.properties", "暂无自定义字段"\)/);
  assert.match(page, /schemaLookup\.properties/);
});

test("A4 lookup response and extension command freeze the reviewed schema target and global CAS version", () => {
  assert.match(page, /const schemaSnapshot = \{ \.\.\.schema \}/);
  assert.match(page, /const registryVersion = overview\?\.stats\.schemaVersion \?\? ""/);
  assert.match(page, /addA4SchemaProperty\(schemaSnapshot\.eventName, propertyName, propertyType, registryVersion, reason, stableKey\)/);
  assert.doesNotMatch(page, /addA4SchemaProperty\(schemaSnapshot\.eventName, propertyName, propertyType, schemaSnapshot\.version/);
});

test("a successful property extension reconciles only its still-current exact lookup and never leaves an old preview beside a new global version", () => {
  assert.match(page, /const lookupTargetAtOpen = schemaLookupEventNameRef\.current\.trim\(\)/);
  assert.match(page, /const lookupSequenceAtOpen = schemaLookupSequence\.current/);
  assert.match(page, /schemaLookupEventNameRef\.current\.trim\(\) === schemaSnapshot\.eventName/);
  assert.match(page, /schemaLookupSequence\.current === lookupSequenceAtOpen/);
  assert.match(page, /schemaLookupSequence\.current \+= 1/);
  assert.match(page, /next\.schemaRegistrations\.find\(\(item\) => item\.eventName === schemaSnapshot\.eventName\) \?\? null/);
  assert.match(page, /setSchemaLookup\(refreshedSchema\)/);
  assert.match(page, /setSchemaLookup\(null\)/);
  assert.match(page, /最新总览未包含该事件，请重新核验当前 Schema/);
  assert.match(page, /schemaLookupEventNameRef\.current = nextEventName/);
});
