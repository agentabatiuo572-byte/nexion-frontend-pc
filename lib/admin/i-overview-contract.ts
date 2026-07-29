type IModuleId = "I1" | "I2" | "I3" | "I4" | "I5" | "I6";

const ARRAY_KEYS: Record<IModuleId, readonly string[]> = {
  I1: [
    "copies", "versions", "experiments", "frameworkParams", "positions",
    "versionOptions", "surfaces", "audiences", "trafficSplits", "sources",
  ],
  I2: [
    "channels", "eventDriven", "templates", "socialDistribution", "socialEvents",
    "socialEventTypes", "socialEventStatuses", "templateStatuses",
    "templateCtaOptions", "sources",
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
    "trustSections", "trustSectionVersions", "pendingTrustSectionKeys",
    "financialFields", "sectionFields", "jurisdictions", "countryOptions",
    "chapters", "gatedActions", "roleGates", "languageScopes",
    "disclosureVersions", "sources",
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
  for (const copy of records(moduleId, value.copies)) {
    optionalArray(moduleId, copy, "usedVersionKeys");
    if (copy.draftAudienceTarget !== undefined) {
      const target = record(moduleId, copy.draftAudienceTarget);
      array(moduleId, target.locales);
      array(moduleId, target.tiers);
    }
  }
  for (const version of records(moduleId, value.versions)) {
    if (version.audienceTarget !== undefined) {
      const target = record(moduleId, version.audienceTarget);
      array(moduleId, target.locales);
      array(moduleId, target.tiers);
    }
  }
  for (const experiment of records(moduleId, value.experiments)) {
    records(moduleId, experiment.variants);
  }
}

function validateI2(moduleId: IModuleId, value: Record<string, unknown>) {
  for (const key of [
    "channels", "eventDriven", "templates", "socialDistribution",
    "socialEvents", "socialEventTypes", "socialEventStatuses", "templateCtaOptions",
  ]) {
    records(moduleId, value[key]);
  }
}

function validateI3(moduleId: IModuleId, value: Record<string, unknown>) {
  records(moduleId, value.campaigns);
  records(moduleId, value.capRules);
  records(moduleId, value.swipeRoutes);
  const audienceCatalog = record(moduleId, value.audienceCatalog);
  records(moduleId, audienceCatalog.phases);
  records(moduleId, audienceCatalog.languages);
  const deliveryCatalog = record(moduleId, value.deliveryCatalog);
  records(moduleId, deliveryCatalog.kinds);
  records(moduleId, deliveryCatalog.ctaRoutes);
}

function validateTrustDisclosure(moduleId: IModuleId, value: Record<string, unknown>) {
  for (const key of [
    "trustSections", "financialFields", "sectionFields", "countryOptions",
    "chapters", "gatedActions",
  ]) {
    records(moduleId, value[key]);
  }
  for (const version of records(moduleId, value.trustSectionVersions)) {
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

function validateI6(moduleId: IModuleId, value: Record<string, unknown>) {
  records(moduleId, value.namespaces);
  for (const issue of records(moduleId, value.integrityIssues)) {
    array(moduleId, issue.samples);
  }
  records(moduleId, value.hardcodedFindings);
  for (const message of records(moduleId, value.messages)) {
    array(moduleId, message.placeholders);
  }
  if (value.focusMessage !== undefined && value.focusMessage !== null) {
    array(moduleId, record(moduleId, value.focusMessage).placeholders);
  }
  for (const course of records(moduleId, value.courses)) {
    for (const question of records(moduleId, course.quizQuestions)) {
      array(moduleId, question.optionsZh);
      array(moduleId, question.optionsEn);
    }
  }
  record(moduleId, value.rewardRange);
  records(moduleId, value.metrics);
}

export function parseIOverview(moduleId: string, input: unknown): unknown {
  if (!Object.hasOwn(ARRAY_KEYS, moduleId)) {
    throw new Error("未知 I 域模块返回数据，已拒绝渲染");
  }
  const scopedModule = moduleId as IModuleId;
  const value = record(scopedModule, input);
  record(scopedModule, value.stats);
  for (const key of ARRAY_KEYS[scopedModule]) array(scopedModule, value[key]);

  if (scopedModule === "I1") validateI1(scopedModule, value);
  if (scopedModule === "I2") validateI2(scopedModule, value);
  if (scopedModule === "I3") validateI3(scopedModule, value);
  if (scopedModule === "I4" || scopedModule === "I5") validateTrustDisclosure(scopedModule, value);
  if (scopedModule === "I6") validateI6(scopedModule, value);
  return input;
}
