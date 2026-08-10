import { formatAdminApiError } from "@/lib/admin/error-messages";

export const CURRENT_L5_REPORT_TYPES = [
  "KPI_SERIES",
  "FUNNEL_COHORT",
  "FINANCE_AGG",
  "OPERATIONS_AGG",
  "NETWORK_TREE",
  "REGULATORY",
] as const;
const REPORT_TYPES = new Set<string>(CURRENT_L5_REPORT_TYPES);

const REPORT_STATUSES = new Set([
  "PENDING",
  "PENDING_CONFIRM",
  "PENDING_SPLIT_CONFIRM",
  "GENERATING",
  "READY",
  "EXPIRED",
  "FAILED",
]);

const MASKING_POLICIES = new Set(["NONE", "MASKED", "PARTIAL", "DECRYPTED"]);
const REQUIRED_SOURCES = [
  "nx_admin_fourth_batch_report",
  "nx_audit_log",
  "nx_wallet_ledger",
  "nx_admin_disclosure_jurisdiction",
  "nx_admin_disclosure_version",
] as const;

function invalid(path: string): never {
  throw new Error(
    `${formatAdminApiError("L5_RESPONSE_INVALID", "L5_RESPONSE_INVALID")} · ${path}`,
  );
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) invalid(path);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(path);
  return value.trim();
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path);
  return value;
}

function count(value: unknown, path: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(path);
  return value as number;
}

function validateSummary(value: unknown) {
  const summary = object(value, "summary");
  const total = count(summary.totalReports, "summary.totalReports");
  const ready = count(summary.readyReports, "summary.readyReports");
  const sensitive = count(summary.sensitiveReports, "summary.sensitiveReports");
  const pending = count(summary.pendingConfirm, "summary.pendingConfirm");
  const legacyReady = count(summary.legacyReadyWithoutSnapshot, "summary.legacyReadyWithoutSnapshot");
  if (ready > total || sensitive > total || pending > total || legacyReady > total) {
    invalid("summary.counts");
  }
}

function validateReport(value: unknown, index: number) {
  const path = `reports.records[${index}]`;
  const report = object(value, path);
  text(report.reportId, `${path}.reportId`);
  text(report.name, `${path}.name`);
  const type = text(report.type, `${path}.type`).toUpperCase();
  if (!REPORT_TYPES.has(type)) invalid(`${path}.type`);
  text(report.cycle, `${path}.cycle`);
  text(report.format, `${path}.format`);
  text(report.scope, `${path}.scope`);
  text(report.fields, `${path}.fields`);
  count(report.rowCount, `${path}.rowCount`);
  bool(report.containsPii, `${path}.containsPii`);
  if (!MASKING_POLICIES.has(text(report.maskingPolicy, `${path}.maskingPolicy`).toUpperCase())) {
    invalid(`${path}.maskingPolicy`);
  }
  if (!REPORT_STATUSES.has(text(report.status, `${path}.status`).toUpperCase())) {
    invalid(`${path}.status`);
  }
  bool(report.snapshotAvailable, `${path}.snapshotAvailable`);
}

function validateReports(value: unknown) {
  const reports = object(value, "reports");
  const total = count(reports.total, "reports.total");
  const pageNum = count(reports.pageNum, "reports.pageNum", 1);
  const pageSize = count(reports.pageSize, "reports.pageSize", 1);
  const records = array(reports.records, "reports.records");
  if (records.length > pageSize || (total === 0 && records.length > 0) || records.length > total) {
    invalid("reports.page");
  }
  records.forEach(validateReport);
  void pageNum;
}

function validateCapabilities(value: unknown) {
  const capabilities = object(value, "capabilities");
  [
    "aggregateExport",
    "networkTreeExport",
    "ledgerBillExport",
    "download",
    "decryptedExport",
    "regulatoryReport",
    "configMutation",
    "scheduleMutation",
    "templateMutation",
  ].forEach((key) => bool(capabilities[key], `capabilities.${key}`));
  if (capabilities.decryptedExport !== false
      || capabilities.configMutation !== false
      || capabilities.scheduleMutation !== false
      || capabilities.templateMutation !== false) {
    invalid("capabilities.failClosed");
  }
}

function validateExportParams(value: unknown) {
  const params = array(value, "exportParams");
  if (params.length === 0) invalid("exportParams");
  params.forEach((value, index) => {
    const row = object(value, `exportParams[${index}]`);
    text(row.k, `exportParams[${index}].k`);
    text(row.v, `exportParams[${index}].v`);
    bool(row.fixed, `exportParams[${index}].fixed`);
    text(row.s, `exportParams[${index}].s`);
  });
}

function validateMaskRules(value: unknown) {
  const rules = array(value, "maskRules");
  if (rules.length === 0) invalid("maskRules");
  rules.forEach((value, index) => {
    const row = object(value, `maskRules[${index}]`);
    ["f", "cat", "catTone", "rule", "ruleNote", "dec", "appr"]
      .forEach((key) => text(row[key], `maskRules[${index}].${key}`));
  });
}

function validateBlockers(value: unknown) {
  const blockers = array(value, "crossModuleBlockers");
  if (blockers.length === 0) invalid("crossModuleBlockers");
  blockers.forEach((value, index) => {
    const row = object(value, `crossModuleBlockers[${index}]`);
    text(row.code, `crossModuleBlockers[${index}].code`);
    text(row.label, `crossModuleBlockers[${index}].label`);
    if (text(row.status, `crossModuleBlockers[${index}].status`) !== "BLOCKED") {
      invalid(`crossModuleBlockers[${index}].status`);
    }
    text(row.reason, `crossModuleBlockers[${index}].reason`);
  });
}

export function assertL5OverviewContract(value: unknown): Record<string, unknown> {
  const data = object(value, "data");
  if (data.module !== "L5" || data.domain !== "L5" || data.serverCanonical !== true) {
    invalid("identity");
  }
  validateSummary(data.summary);
  validateReports(data.reports);
  validateCapabilities(data.capabilities);
  validateExportParams(data.exportParams);
  validateMaskRules(data.maskRules);
  validateBlockers(data.crossModuleBlockers);

  const statusEnum = array(data.statusEnum, "statusEnum").map((value, index) =>
    text(value, `statusEnum[${index}]`).toUpperCase());
  if (statusEnum.length !== REPORT_STATUSES.size
      || statusEnum.some((status) => !REPORT_STATUSES.has(status))
      || new Set(statusEnum).size !== REPORT_STATUSES.size) {
    invalid("statusEnum");
  }

  const sources = array(data.sources, "sources").map((value, index) =>
    text(value, `sources[${index}]`));
  if (new Set(sources).size !== sources.length
      || REQUIRED_SOURCES.some((source) => !sources.includes(source))) {
    invalid("sources");
  }
  array(data.regulatoryTemplates, "regulatoryTemplates");
  object(data.ledgerLive, "ledgerLive");
  return data;
}
