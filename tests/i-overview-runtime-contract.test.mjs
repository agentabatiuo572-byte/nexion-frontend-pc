import assert from "node:assert/strict";
import test from "node:test";

import { parseIOverview } from "../lib/admin/i-overview-contract.ts";

const VALID = {
  I1: {
    stats: {},
    copies: [],
    versions: [],
    experiments: [],
    frameworkParams: [],
    positions: [],
    versionOptions: [],
    surfaces: [],
    audiences: [],
    trafficSplits: [],
    sources: [],
  },
  I2: {
    stats: {},
    channels: [],
    eventDriven: [],
    templates: [],
    socialDistribution: [],
    socialEvents: [],
    socialEventTypes: [],
    socialEventStatuses: [],
    templateStatuses: [],
    templateCtaOptions: [],
    runtimeSourceOptions: [],
    sources: [],
  },
  I3: {
    stats: {},
    campaigns: [],
    capRules: [],
    tiers: [],
    audiences: [],
    statuses: [],
    swipeRoutes: [],
    audienceCatalog: { phases: [], languages: [], conditionLogic: "AND" },
    deliveryCatalog: { kinds: [], ctaRoutes: [] },
    sources: [],
  },
  I4: {
    stats: {},
    trustSections: [],
    trustSectionVersions: [],
    pendingTrustSectionKeys: [],
    financialFields: [],
    sectionFields: [],
    jurisdictions: [],
    countryOptions: [],
    chapters: [],
    gatedActions: [],
    roleGates: [],
    languageScopes: [],
    disclosureVersions: [],
    gateScope: "",
    sources: [],
  },
  I6: {
    stats: {},
    namespaces: [],
    integrityIssues: [],
    hardcodedFindings: [],
    messages: [],
    courses: [],
    rewardRange: { min: 0, max: 0 },
    featuredCourseId: "",
    metrics: [],
    categories: [],
    formats: [],
    levels: [],
    statuses: [],
    sources: [],
  },
};

test("I1-I6 overview 协议接受完整对象", () => {
  for (const [moduleId, value] of Object.entries(VALID)) {
    assert.equal(parseIOverview(moduleId, value), value);
  }
  assert.equal(parseIOverview("I5", VALID.I4), VALID.I4);
});

test("I1 畸形 copies 数组必须失败关闭", () => {
  assert.throws(
    () => parseIOverview("I1", { ...VALID.I1, copies: "malformed" }),
    /I1 返回数据格式异常，请刷新重试/,
  );
});

test("I2 畸形模板数组必须失败关闭", () => {
  assert.throws(
    () => parseIOverview("I2", { ...VALID.I2, templates: {} }),
    /I2 返回数据格式异常，请刷新重试/,
  );
});

test("I3 畸形受众目录必须失败关闭", () => {
  assert.throws(
    () => parseIOverview("I3", {
      ...VALID.I3,
      audienceCatalog: { phases: "malformed", languages: [], conditionLogic: "AND" },
    }),
    /I3 返回数据格式异常，请刷新重试/,
  );
});

test("I4/I5 畸形版本字段列表必须失败关闭", () => {
  assert.throws(
    () => parseIOverview("I4", {
      ...VALID.I4,
      trustSectionVersions: [{ fields: "malformed" }],
    }),
    /I4 返回数据格式异常，请刷新重试/,
  );
});

test("I6 畸形词条占位符必须失败关闭", () => {
  assert.throws(
    () => parseIOverview("I6", {
      ...VALID.I6,
      messages: [{ placeholders: "malformed" }],
    }),
    /I6 返回数据格式异常，请刷新重试/,
  );
});
