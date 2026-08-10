import { parseStrictFiniteNumber } from "./strict-number.ts";

type PageEnvelope<T> = {
  total?: unknown;
  pageNum?: unknown;
  pageSize?: unknown;
  records?: unknown;
};

export type AuthoritativePage<T> = {
  total: number;
  pageNum: number;
  pageSize: number;
  records: T[];
};

function invalid(field: string): never {
  throw new Error(`AUTHORITATIVE_PAGE_INVALID:${field}`);
}

function positiveInteger(value: unknown, field: string): number {
  const parsed = parseStrictFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 1) invalid(field);
  return parsed;
}

function nonNegativeInteger(value: unknown, field: string): number {
  const parsed = parseStrictFiniteNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0) invalid(field);
  return parsed;
}

export function normalizeAuthoritativePage<T>(
  value: PageEnvelope<T>,
  requestedPageNum: number,
  requestedPageSize: number,
): AuthoritativePage<T> {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Array.isArray(value.records)) {
    invalid("records");
  }
  const expectedPageNum = positiveInteger(requestedPageNum, "requestedPageNum");
  const expectedPageSize = positiveInteger(requestedPageSize, "requestedPageSize");
  const total = nonNegativeInteger(value.total, "total");
  const pageNum = positiveInteger(value.pageNum, "pageNum");
  const pageSize = positiveInteger(value.pageSize, "pageSize");
  if (pageNum !== expectedPageNum) invalid("pageNum");
  if (pageSize !== expectedPageSize) invalid("pageSize");
  if (value.records.length > pageSize || value.records.length > total) invalid("records");
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageNum > pageCount) {
    if (value.records.length > 0) invalid("records");
  } else {
    const expectedRecords = Math.min(pageSize, Math.max(0, total - (pageNum - 1) * pageSize));
    if (value.records.length !== expectedRecords) invalid("records");
  }
  return { total, pageNum, pageSize, records: value.records as T[] };
}
