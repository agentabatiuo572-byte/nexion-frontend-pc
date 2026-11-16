import { parseI6Overview } from "./i6-learning-contract";
import { parseI4SectionVersion } from "./i4-trust-contract";

type IModuleId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6";

const ARRAY_KEYS: Record<IModuleId, readonly string[]> = {
  I1: [
    "copies", "versions", "experiments", "frameworkParams", "positions",
    "versionOptions", "surfaces", "audiences", "trafficSplits", "sources",
  ],
  I2: [
    "channels", "eventDriven", "templates", "socialDistribution", "socialEvents",
    "socialEventTypes", "socialEventStatuses", "templateStatuses",
    "templateCtaOptions", "runtimeSourceOptions", "sources",
  ],
  I3: [
    "campaigns", "capRules", "tiers", "audiences", "statuses", "swipeRoutes", "sources",
  ],
  I4: [
    "trustSections", "trustSectionVersions", "pendingTrustSectionKeys",
    "financialFields", "sectionFields", "jurisdictions", "countryOptions",
    "chapters", "gatedActions", "roleGates", "languageScopes",
    "disclosureVersions", "sources",
  ],
  I5: [
    "jurisdictions", "countryOptions", "chapters", "gatedActions", "roleGates",
    "languageScopes", "disclosureVersions", "sources",
  ],
  I6: [
    "namespaces", "integrityIssues", "hardcodedFindings", "messages", "courses",
    "metrics", "categories", "formats", "levels", "statuses", "sources",
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(moduleId: IModuleId): never {
  throw new Error(`${moduleId} 返回数据格式异常，请刷新重试`);
}

function record(moduleId: IModuleId, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) fail(moduleId);
  return value;
}

function array(moduleId: IModuleId, value: unknown): unknown[] {
  if (!Array.isArray(value)) fail(moduleId);
  return value;
}

function records(moduleId: IModuleId, value: unknown): Record<string, unknown>[] {
  return array(moduleId, value).map((item) => record(moduleId, item));
}

function optionalArray(moduleId: IModuleId, owner: Record<string, unknown>, key: string) {
  if (owner[key] !== undefined && !Array.isArray(owner[key])) fail(moduleId);
}

function validateI1(moduleId: IModuleId, value: Record<string, unknown>) {
  for (const option of records(moduleId, value.versionOptions)) {
    if (typeof option.status !== "string" || !["ACTIVE", "INACTIVE"].includes(option.status.toUpperCase())) fail(moduleId);
    // The repository emits lowercase statuses; the editor and write DTO use uppercase.
    option.status = option.status.toUpperCase();
  }
  for (const copy of records(moduleId, value.copies)) {
    optionalArray(moduleId, copy, "usedVersionKeys");
    if (copy.draftAudienceTarget != null) {
      const target = record(moduleId, copy.draftAudienceTarget);
      array(moduleId, target.locales);
      array(moduleId, target.tiers);
    }
  }
  for (const version of records(moduleId, value.versions)) {
    for (const key of ["copyKey", "version", "status", "surface", "audience", "trafficSplit", "zh", "en"]) {
      if (typeof version[key] !== "string") fail(moduleId);
    }
    // Legacy versions may lack Vietnamese text or a note. Keep the overview
    // readable; the publication preflight, not the parser, rejects missing copy.
    for (const key of ["vi", "versionNote"]) {
      if (version[key] == null) version[key] = "";
      else if (typeof version[key] !== "string") fail(moduleId);
    }
    if (version.copyPosition != null && typeof version.copyPosition !== "string") fail(moduleId);
    if (version.audienceTarget != null) {
      const target = record(moduleId, version.audienceTarget);
      for (const key of ["locales", "tiers"]) if (!array(moduleId, target[key]).every((item) => typeof item === "string")) fail(moduleId);
      if (target.mode != null && typeof target.mode !== "string") fail(moduleId);
      for (const key of ["registrationDaysMin", "registrationDaysMax"]) {
        if (target[key] != null && (typeof target[key] !== "number" || !Number.isInteger(target[key]))) fail(moduleId);
      }
    }
    if (version.translations != null) {
      const translations = record(moduleId, version.translations);
      if (Object.values(translations).some((text) => text !== null && typeof text !== "string")) fail(moduleId);
    }
  }
  for (const experiment of records(moduleId, value.experiments)) {
    for (const variant of records(moduleId, experiment.variants)) {
      for (const key of ["impressions", "conversions"]) {
        const count = variant[key];
        // Older backends omit these fields. Missing is unknown, never zero.
        if (count !== undefined && (typeof count !== "number" || !Number.isInteger(count) || count < 0)) fail(moduleId);
      }
    }
  }
}

function validateI2(moduleId: IModuleId, value: Record<string, unknown>) {
  const stats = record(moduleId, value.stats);
  for (const key of ["todayDelivered", "weeklySocial", "ctr"]) if (typeof stats[key] !== "string") fail(moduleId);
  for (const key of ["ctrTarget", "onlineChannels", "totalChannels"]) if (typeof stats[key] !== "number" || !Number.isInteger(stats[key])) fail(moduleId);
  for (const channel of records(moduleId, value.channels)) {
    if (!["key", "name", "trigger", "tick", "cooldown", "phaseKeyed"].every((key) => typeof channel[key] === "string")
      || typeof channel.ctr !== "number" || !Number.isFinite(channel.ctr) || typeof channel.enabled !== "boolean") fail(moduleId);
  }
  for (const event of records(moduleId, value.eventDriven)) if (!["name", "reason", "owner", "tone", "status"].every((key) => typeof event[key] === "string")) fail(moduleId);
  for (const template of records(moduleId, value.templates)) if (!["channel", "name", "cta", "version", "status", "titleZh", "bodyZh", "titleVi", "bodyVi", "titleEn", "bodyEn"].every((key) => typeof template[key] === "string")) fail(moduleId);
  for (const item of records(moduleId, value.socialDistribution)) if (!["key", "name", "color"].every((key) => typeof item[key] === "string")
    || typeof item.pct !== "number" || !Number.isInteger(item.pct) || item.pct < 0 || item.pct > 100) fail(moduleId);
  for (const event of records(moduleId, value.socialEvents)) validateNovaEvent(event);
  for (const key of ["socialEventTypes", "socialEventStatuses", "templateCtaOptions", "runtimeSourceOptions"]) {
    for (const option of records(moduleId, value[key])) if (typeof option.value !== "string" || typeof option.label !== "string") fail(moduleId);
  }
  for (const key of ["templateStatuses", "sources"]) if (!array(moduleId, value[key]).every((item) => typeof item === "string")) fail(moduleId);
}

function validateNovaEvent(event: Record<string, unknown>) {
  if (typeof event.id !== "number" || !Number.isSafeInteger(event.id) || event.id <= 0
    || !["eventType", "sourceSystem", "sourceEventId", "actorDisplay", "cityDisplay", "amountDisplay", "sourceNote", "occurredAt", "expiresAt", "createdAt", "updatedAt"].every((key) => typeof event[key] === "string")
    || typeof event.status !== "string" || !["ACTIVE", "DISABLED", "EXPIRED"].includes(event.status)
    || typeof event.dispatchCount !== "number" || !Number.isInteger(event.dispatchCount) || event.dispatchCount < 0) fail("I2");
  // Optional timestamps are actually nullable; preserve null instead of manufacturing a date or zero.
  for (const key of ["verifiedAt", "lastDispatchedAt"]) if (event[key] != null && typeof event[key] !== "string") fail("I2");
}

export function parseNovaSocialEventPage(input: unknown): unknown {
  const page = record("I2", input);
  for (const event of records("I2", page.items)) validateNovaEvent(event);
  if (typeof page.page !== "number" || !Number.isInteger(page.page) || page.page < 1
    || typeof page.pageSize !== "number" || !Number.isInteger(page.pageSize) || page.pageSize < 1 || page.pageSize > 100
    || typeof page.total !== "number" || !Number.isInteger(page.total) || page.total < 0) fail("I2");
  return input;
}

export function parseNovaSocialSample(input: unknown): unknown {
  if (input === null) return null;
  const sample = record("I2", input);
  if (typeof sample.id !== "number" || !Number.isSafeInteger(sample.id) || sample.id <= 0
    || !["eventType", "sourceEventId", "language", "title", "body", "expiresAt"].every((key) => typeof sample[key] === "string")) fail("I2");
  return input;
}

function validateI3(moduleId: IModuleId, value: Record<string, unknown>) {
  const stats = record(moduleId, value.stats);
  for (const key of ["monthCampaigns", "monthSent", "monthScheduled", "monthDraft", "criticalInflight"]) {
    if (typeof stats[key] !== "number" || !Number.isInteger(stats[key]) || Number(stats[key]) < 0) fail(moduleId);
  }
  for (const key of ["avgReadRate", "weeklySwipe"]) if (typeof stats[key] !== "string") fail(moduleId);
  for (const campaign of records(moduleId, value.campaigns)) parseNotificationCampaign(campaign);
  for (const cap of records(moduleId, value.capRules)) {
    if (!["critical", "high", "normal", "low"].includes(String(cap.tier))
      || typeof cap.cap !== "string" || typeof cap.policy !== "string" || typeof cap.locked !== "boolean") fail(moduleId);
  }
  for (const route of records(moduleId, value.swipeRoutes)) {
    if (!["kind", "to", "note"].every((key) => typeof route[key] === "string")) fail(moduleId);
  }
  const audienceCatalog = record(moduleId, value.audienceCatalog);
  const deliveryCatalog = record(moduleId, value.deliveryCatalog);
  for (const options of [audienceCatalog.phases, audienceCatalog.languages, deliveryCatalog.kinds, deliveryCatalog.ctaRoutes]) {
    for (const option of records(moduleId, options)) {
      if (typeof option.value !== "string" || typeof option.label !== "string") fail(moduleId);
    }
  }
  if (audienceCatalog.conditionLogic !== "AND") fail(moduleId);
  for (const key of ["tiers", "audiences", "statuses", "sources"]) {
    if (!array(moduleId, value[key]).every((item) => typeof item === "string")) fail(moduleId);
  }
}

/** Shared by the overview, durable original-row snapshots and write receipts at their input boundaries. */
export function parseNotificationCampaign(input: unknown): unknown {
  const row = record("I3", input);
  if (!["id", "name", "kind", "audience", "reach", "schedule", "sent", "read", "bodyZh", "bodyVi", "bodyEn", "ctaHref", "ctaLabel", "swipeTo"].every((key) => typeof row[key] === "string")
    || !["critical", "high", "normal", "low"].includes(String(row.tier))
    || !["draft", "scheduled", "sending", "sent", "failed", "cancelled"].includes(String(row.status))
    || typeof row.revision !== "number" || !Number.isInteger(row.revision) || row.revision < 0) fail("I3");
  // BigDecimal budget is nullable. No decimal rounding or default zero at the read boundary.
  if (row.budget != null && !(typeof row.budget === "string" && /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(row.budget))
    && !(typeof row.budget === "number" && Number.isFinite(row.budget) && row.budget >= 0)) fail("I3");
  const target = record("I3", row.audienceTarget);
  if (!["phaseMin", "phaseMax", "language"].every((key) => typeof target[key] === "string")
    || typeof target.registrationDaysMin !== "number" || !Number.isInteger(target.registrationDaysMin)
    || target.registrationDaysMin < 0 || target.registrationDaysMin > 36500) fail("I3");
  return input;
}

function validateTrustDisclosure(moduleId: IModuleId, value: Record<string, unknown>) {
  // I4's overview is shared with I5. Validate only I4 fields here; do not change I5's read contract.
  if (moduleId === "I4") {
    const stats = record(moduleId, value.stats);
    if (!Number.isSafeInteger(stats.managedSections) || Number(stats.managedSections) < 0) fail(moduleId);
    for (const section of records(moduleId, value.trustSections)) {
      if (!["key", "desc", "struct", "version", "status", "lastChange", "roleGate"].every(key => typeof section[key] === "string")
        || typeof section.highSensitivity !== "boolean") fail(moduleId);
    }
    records(moduleId, value.trustSectionVersions).forEach(parseI4SectionVersion);
    if (!array(moduleId, value.pendingTrustSectionKeys).every(key => typeof key === "string")) fail(moduleId);
    for (const field of records(moduleId, value.financialFields)) {
      if (typeof field.key !== "string" || typeof field.value !== "string" || field.delta != null && typeof field.delta !== "string") fail(moduleId);
    }
    for (const field of records(moduleId, value.sectionFields)) {
      if (!["sectionKey", "key", "value"].every(key => typeof field[key] === "string")) fail(moduleId);
    }
  }
  for (const key of moduleId === "I4"
    ? ["trustSections", "financialFields", "sectionFields", "countryOptions", "chapters", "gatedActions"]
    : ["countryOptions", "chapters", "gatedActions"]) {
    records(moduleId, value[key]);
  }
  if (moduleId === "I4") for (const version of records(moduleId, value.trustSectionVersions)) {
    records(moduleId, version.fields);
  }
  for (const jurisdiction of records(moduleId, value.jurisdictions)) {
    array(moduleId, jurisdiction.countryCodes);
  }
  if (value.disclosureVersionItems !== undefined) {
    for (const version of records(moduleId, value.disclosureVersionItems)) {
      records(moduleId, version.chapters);
    }
  }
  if (value.jurisdictionCatalog !== undefined) records(moduleId, value.jurisdictionCatalog);
  for (const key of ["nextDisclosureVersionByJurisdiction", "nextVersionByJurisdiction"]) {
    if (value[key] !== undefined) record(moduleId, value[key]);
  }
}


export function parseIOverview(moduleId: string, input: unknown): unknown {
  if (!Object.hasOwn(ARRAY_KEYS, moduleId)) {
    throw new Error("未知 I 域模块返回数据，已拒绝渲染");
  }
  const scopedModule = moduleId as IModuleId;
  if (scopedModule === "I6") return parseI6Overview(input);
  const value = record(scopedModule, input);
  record(scopedModule, value.stats);
  for (const key of ARRAY_KEYS[scopedModule]) array(scopedModule, value[key]);

  if (scopedModule === "I1") validateI1(scopedModule, value);
  if (scopedModule === "I2") validateI2(scopedModule, value);
  if (scopedModule === "I3") validateI3(scopedModule, value);
  if (scopedModule === "I4" || scopedModule === "I5") validateTrustDisclosure(scopedModule, value);
  return input;
}
