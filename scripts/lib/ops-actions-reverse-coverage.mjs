import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const CLIENT_WRITE_EXCEPTIONS = Object.freeze({
  estimateI3Audience: "POST query that only estimates an audience and does not persist state",
  previewB5Thresholds: "POST query that only previews threshold effects and does not persist state",
});

function parse(source, fileName = "source.tsx") {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function walk(node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function stringLiterals(node) {
  const values = new Set();
  walk(node, (child) => {
    if (ts.isStringLiteralLike(child)) values.add(child.text);
  });
  return values;
}

function functionReturns(node) {
  const values = new Set();
  walk(node, (child) => {
    if (ts.isReturnStatement(child) && child.expression) {
      for (const value of stringLiterals(child.expression)) values.add(value);
    }
  });
  return values;
}

/** Extract every concrete operation reachable by a findHighOp call. */
export function collectHighOpCandidates(source, fileName) {
  const tree = parse(source, fileName);
  const variables = new Map();
  const resolvers = new Map();

  walk(tree, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      resolvers.set(node.name.text, functionReturns(node));
    } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializers = variables.get(node.name.text) ?? [];
      initializers.push(node.initializer);
      variables.set(node.name.text, initializers);
      if (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) {
        resolvers.set(node.name.text, functionReturns(node.initializer));
      }
    }
  });

  const resolve = (expression, seen = new Set()) => {
    const values = new Set();
    if (!expression) return values;
    if (ts.isStringLiteralLike(expression)) {
      values.add(expression.text);
    } else if (ts.isConditionalExpression(expression)) {
      for (const value of resolve(expression.whenTrue, seen)) values.add(value);
      for (const value of resolve(expression.whenFalse, seen)) values.add(value);
    } else if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) {
      for (const value of resolve(expression.expression, seen)) values.add(value);
    } else if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
      const nextSeen = new Set(seen).add(expression.text);
      for (const initializer of variables.get(expression.text) ?? []) {
        for (const value of resolve(initializer, nextSeen)) values.add(value);
      }
    } else if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
      for (const value of resolvers.get(expression.expression.text) ?? []) values.add(value);
    }
    return values;
  };

  const operations = new Set();
  walk(tree, (node) => {
    if (!ts.isCallExpression(node)) return;
    const callee = node.expression;
    const isFindHighOp = (ts.isIdentifier(callee) && callee.text === "findHighOp")
      || (ts.isPropertyAccessExpression(callee) && callee.name.text === "findHighOp");
    if (!isFindHighOp) return;
    for (const value of resolve(node.arguments[0])) operations.add(value);
  });
  return operations;
}

export function collectHighOpRegistryOps(source, fileName = "high-ops-registry.ts") {
  const tree = parse(source, fileName);
  const operations = new Set();
  walk(tree, (node) => {
    if (!ts.isPropertyAssignment(node)) return;
    const name = ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name) ? node.name.text : "";
    if (name === "op" && ts.isStringLiteralLike(node.initializer)) operations.add(node.initializer.text);
  });
  return operations;
}

/** Read the static l2 navigation objects without depending on manifest data. */
export function collectActiveNavLeaves(source, fileName = "console-nav.ts") {
  const tree = parse(source, fileName);
  const leaves = [];
  walk(tree, (node) => {
    if (!ts.isObjectLiteralExpression(node)) return;
    const fields = new Map();
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : "";
      if (ts.isStringLiteralLike(property.initializer)) fields.set(name, property.initializer.text);
    }
    const id = fields.get("id");
    const path = fields.get("path");
    if (/^[A-M]\d+$/.test(id ?? "") && path?.startsWith("/") && fields.get("status") === "flagship") leaves.push({ id, path });
  });
  return leaves;
}

function containsWriteMethod(node) {
  let found = false;
  walk(node, (child) => {
    if (ts.isPropertyAssignment(child)) {
      const name = child.name && (ts.isIdentifier(child.name) || ts.isStringLiteralLike(child.name)) ? child.name.text : "";
      const initializer = child.initializer;
      if (name === "method" && ts.isStringLiteralLike(initializer) && WRITE_METHODS.has(initializer.text.toUpperCase())) found = true;
    }
    if (ts.isCallExpression(child)) {
      for (const argument of child.arguments) {
        if (ts.isStringLiteralLike(argument) && WRITE_METHODS.has(argument.text.toUpperCase())) found = true;
      }
    }
  });
  return found;
}

/** Find exported PC client functions/object methods that issue a mutating HTTP request. */
export function collectClientWriteSymbols(source, fileName) {
  const tree = parse(source, fileName);
  const symbols = new Set();
  const candidates = new Map();
  const exportedNames = new Set();

  const register = (name, node, exported) => {
    if (!name || !node) return;
    candidates.set(name, node);
    if (exported) exportedNames.add(name);
  };

  for (const statement of tree.statements) {
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      register(statement.name.text, statement, exported);
      if (exported && containsWriteMethod(statement)) symbols.add(statement.name.text);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!declaration.initializer) continue;
      if (ts.isIdentifier(declaration.name) && containsWriteMethod(declaration.initializer)
        && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
        if (exported) symbols.add(declaration.name.text);
      }
      if (ts.isIdentifier(declaration.name)
        && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
        register(declaration.name.text, declaration.initializer, exported);
      }
      if (!ts.isObjectLiteralExpression(declaration.initializer)) continue;
      for (const property of declaration.initializer.properties) {
        if (!(ts.isPropertyAssignment(property) || ts.isMethodDeclaration(property))) continue;
        if (!(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) continue;
        register(property.name.text, property, exported);
        if (exported && containsWriteMethod(property)) symbols.add(property.name.text);
      }
    }
  }

  // A client mutation is often an exported wrapper around a private request
  // helper (H1 month dials are the canonical case). Discovering only the
  // literal `method: "PATCH"` function leaves that real write invisible to the
  // reverse ledger. Propagate mutating reachability through the local call
  // graph so wrappers cannot escape exact, unique manifest claims.
  const mutating = new Set(
    [...candidates].filter(([, node]) => containsWriteMethod(node)).map(([name]) => name),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, node] of candidates) {
      if (mutating.has(name)) continue;
      let callsMutation = false;
      walk(node, (child) => {
        if (callsMutation || !ts.isCallExpression(child)) return;
        const callee = child.expression;
        const called = ts.isIdentifier(callee) ? callee.text
          : ts.isPropertyAccessExpression(callee) ? callee.name.text : undefined;
        if (called && mutating.has(called)) callsMutation = true;
      });
      if (callsMutation) {
        mutating.add(name);
        changed = true;
      }
    }
  }
  for (const name of exportedNames) if (mutating.has(name)) symbols.add(name);
  return symbols;
}

export function collectCalledSymbols(source, symbols, fileName = "source.tsx") {
  const wanted = symbols instanceof Set ? symbols : new Set(symbols);
  const tree = parse(source, fileName);
  const calls = [];
  walk(tree, (node) => {
    if (!ts.isCallExpression(node)) return;
    let name;
    if (ts.isIdentifier(node.expression)) name = node.expression.text;
    else if (ts.isPropertyAccessExpression(node.expression)) name = node.expression.name.text;
    if (!name || !wanted.has(name)) return;
    const { line } = tree.getLineAndCharacterOfPosition(node.getStart(tree));
    calls.push({ action: name, line: line + 1 });
  });
  return calls;
}

function rowActions(row) {
  return [...new Set([
    ...(typeof row.restAction === "string" ? [row.restAction] : []),
    ...(Array.isArray(row.restActions) ? row.restActions : []),
  ])];
}

/** Reverse-check discovered leaf/action callsites against leaf-scoped row claims. */
export function evaluateManifestClaims({ manifest, writePoints }) {
  const problems = [];
  const matches = [];

  for (const point of writePoints) {
    const claimingRows = (manifest.rows ?? [])
      .filter((row) => rowActions(row).includes(point.action));
    if (claimingRows.length !== 1) {
      problems.push(
        `${point.file}:${point.line} ${point.leaf}/${point.action} must have exactly one manifest claim; found ${claimingRows.length}`,
      );
    } else {
      matches.push({ ...point, rowId: claimingRows[0].id });
    }
  }
  return { problems, matches };
}

function sourceFiles(root, relativeRoot, extensions = /\.(?:ts|tsx)$/) {
  const files = [];
  const absoluteRoot = join(root, relativeRoot);
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    const childRelative = join(relativeRoot, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(root, childRelative, extensions));
    else if (extensions.test(entry.name)) files.push(childRelative.replaceAll("\\", "/"));
  }
  return files;
}

function leafFromSource(file, action, leaves) {
  const activeIds = new Set(leaves.map((leaf) => leaf.id));
  const normalized = file.replaceAll("\\", "/");
  for (const leaf of leaves.toSorted((a, b) => b.path.length - a.path.length)) {
    const route = `app/_console${leaf.path}/`;
    if (normalized.startsWith(route)) return leaf.id;
  }
  const actionPrefix = action.match(/(?:^|[^a-z])([a-m])(\d+)/i) ?? action.match(/([A-M])(\d+)/);
  const actionLeaf = actionPrefix ? `${actionPrefix[1].toUpperCase()}${Number(actionPrefix[2])}` : undefined;
  if (actionLeaf && activeIds.has(actionLeaf)) return actionLeaf;

  const tab = normalized.match(/\/([a-m])-tabs\/\1(\d+)(?:[-/]|\.)/i);
  if (tab) {
    const leaf = `${tab[1].toUpperCase()}${Number(tab[2])}`;
    if (activeIds.has(leaf)) return leaf;
  }
  const exact = new Map([
    ["app/_console/platform/params-registry/params-registry-client.tsx", "A5"],
    ["app/components/domain-views/a-tabs/a6-roles.tsx", "A6"],
    ["app/components/domain-views/a-tabs/a7-menus.tsx", "A7"],
    ["app/components/domain-views/a-tabs/a8-permissions.tsx", "A8"],
    ["lib/store/admin/janus-c2-store.ts", "K6"],
  ]);
  if (exact.has(normalized)) return exact.get(normalized);
  return undefined;
}

function domainFromSharedView(file) {
  const match = file.replaceAll("\\", "/").match(/\/domain-views\/([a-m])-view\.tsx$/i);
  return match?.[1].toUpperCase();
}

function deriveLeafSurfaces(leaves, files) {
  const fileSet = new Set(files);
  const overrides = new Map([
    ["A5", ["app/_console/platform/params-registry/params-registry-client.tsx"]],
    ["H4", ["app/components/domain-views/h-tabs/h3-quest-events.tsx"]],
    ["I5", ["app/components/domain-views/i-tabs/i4-trust.tsx"]],
  ]);
  const result = new Map();
  for (const leaf of leaves) {
    const lower = leaf.id.toLowerCase();
    const domain = lower[0];
    const routePrefix = `app/_console${leaf.path}/`;
    const tabPrefix = `app/components/domain-views/${domain}-tabs/${lower}`;
    const candidates = files.filter((file) => file.startsWith(routePrefix)
      || file === `${routePrefix.slice(0, -1)}.tsx`
      || file.startsWith(`${tabPrefix}-`)
      || file.startsWith(`${tabPrefix}/`)
      || file === `${tabPrefix}.tsx`);
    for (const override of overrides.get(leaf.id) ?? []) {
      if (fileSet.has(override)) candidates.push(override);
    }
    result.set(leaf.id, [...new Set(candidates)]);
  }
  return result;
}

/**
 * Derive the reverse gate from navigation, active source callsites and lib/admin
 * HTTP write implementations. No row IDs or action whitelist are accepted.
 */
export function auditRepositoryReverseCoverage({ root, manifest }) {
  const read = (file) => readFileSync(join(root, file), "utf8");
  const leaves = collectActiveNavLeaves(read("lib/nav/console-nav.ts"));
  const registeredHighOps = collectHighOpRegistryOps(read("lib/admin/high-ops-registry.ts"));
  const writeSymbols = new Set();
  for (const file of sourceFiles(root, "lib/admin")) {
    for (const symbol of collectClientWriteSymbols(read(file), file)) writeSymbols.add(symbol);
  }
  // Infrastructure transports are not product actions: their concrete high-op
  // argument is audited separately at the same active callsite.
  writeSymbols.delete("createA2OperationProposal");
  for (const symbol of Object.keys(CLIENT_WRITE_EXCEPTIONS)) writeSymbols.delete(symbol);

  const sourceRoots = ["app", "lib/store/admin"];
  const files = sourceRoots.flatMap((sourceRoot) => sourceFiles(root, sourceRoot));
  const leafSurfaces = deriveLeafSurfaces(leaves, files);
  const writePoints = [];
  for (const file of files) {
    const source = read(file);
    for (const call of collectCalledSymbols(source, writeSymbols, file)) {
      const leaf = leafFromSource(file, call.action, leaves);
      const domain = domainFromSharedView(file);
      if (leaf || domain) writePoints.push({ ...call, leaf, domain, file, kind: "client" });
    }
    for (const action of collectHighOpCandidates(source, file)) {
      const leaf = leafFromSource(file, action, leaves);
      const tree = parse(source, file);
      let line = 1;
      walk(tree, (node) => {
        if (line !== 1 || !ts.isCallExpression(node)) return;
        const callee = node.expression;
        if ((ts.isIdentifier(callee) && callee.text === "findHighOp")
          || (ts.isPropertyAccessExpression(callee) && callee.name.text === "findHighOp")) {
          line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1;
        }
      });
      writePoints.push({ action, leaf, file, line, kind: "high-op" });
    }
  }

  const uniquePoints = [...new Map(writePoints.map((point) => [
    `${point.leaf ?? "*"}|${point.action}|${point.file}`,
    point,
  ])).values()];
  const result = evaluateManifestClaims({ manifest, writePoints: uniquePoints });
  for (const point of uniquePoints.filter((item) => item.kind === "high-op")) {
    if (!registeredHighOps.has(point.action)) {
      result.problems.push(`${point.file}:${point.line} findHighOp(${point.action}) is not declared in HIGH_OPS`);
    }
  }
  const activeLeafIds = leaves.map((leaf) => leaf.id);
  const coverageIds = Object.keys(manifest.activeLeafCoverage ?? {});
  if (new Set(activeLeafIds).size !== activeLeafIds.length) result.problems.push("navigation contains duplicate active leaf IDs");
  for (const leaf of activeLeafIds) {
    if (!coverageIds.includes(leaf)) result.problems.push(`${leaf}: active navigation leaf has no manifest coverage entry`);
    if ((leafSurfaces.get(leaf) ?? []).length === 0) result.problems.push(`${leaf}: active navigation leaf has no reachable PC surface source`);
  }
  for (const leaf of coverageIds) {
    if (!activeLeafIds.includes(leaf)) result.problems.push(`${leaf}: manifest coverage entry is not an active navigation leaf`);
  }
  return { ...result, leaves, leafSurfaces, registeredHighOps, writeSymbols, writePoints: uniquePoints };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate optional serviceDelegations evidence on any row, including pending rows.
 * This intentionally does not infer or mutate status: it is a verifiable contract
 * that the pending->built workflow may populate before changing status.
 */
export function validateServiceDelegations(manifest, readText) {
  const problems = [];
  for (const row of manifest.rows ?? []) {
    if (row.serviceDelegations === undefined) continue;
    if (!Array.isArray(row.serviceDelegations) || row.serviceDelegations.length === 0) {
      problems.push(`${row.id}: serviceDelegations must be a non-empty array`);
      continue;
    }
    for (const [index, item] of row.serviceDelegations.entries()) {
      const label = `${row.id}.serviceDelegations[${index}]`;
      for (const field of ["controllerFile", "controllerCall", "serviceFile", "serviceMethod"]) {
        if (typeof item?.[field] !== "string" || item[field].trim() === "") problems.push(`${label}: missing ${field}`);
      }
      if (!item?.controllerFile || !item?.serviceFile) continue;
      const controller = readText(item.controllerFile);
      const service = readText(item.serviceFile);
      if (typeof controller !== "string") problems.push(`${label}: missing controller file ${item.controllerFile}`);
      else if (item.controllerCall && !controller.includes(item.controllerCall)) {
        problems.push(`${label}: controller does not delegate via ${item.controllerCall}`);
      }
      if (typeof service !== "string") problems.push(`${label}: missing service file ${item.serviceFile}`);
      else if (item.serviceMethod) {
        const methodPattern = new RegExp(`\\b(?:public|protected|private)?\\s*[\\w<>?, .\\[\\]]+\\s+${escapeRegExp(item.serviceMethod)}\\s*\\(`);
        if (!methodPattern.test(service)) problems.push(`${label}: service method ${item.serviceMethod} not found`);
      }
    }
  }
  return problems;
}

const RUNTIME_EVIDENCE_TYPES = new Set([
  "pc-runtime",
  "pc-navigation",
  "backend-runtime",
  "uniapp-runtime",
  "janus-runtime",
]);

/**
 * Validate source-backed runtime evidence for built capabilities which do not
 * own a distinct PC mutation. Patterns are regex sources so the manifest can
 * assert both the required consumer and the absence of a known stub/fallback.
 */
export function validateRuntimeEvidence(manifest, readText) {
  const problems = [];
  for (const row of manifest.rows ?? []) {
    if (row.runtimeEvidence === undefined) continue;
    if (!Array.isArray(row.runtimeEvidence) || row.runtimeEvidence.length === 0) {
      problems.push(`${row.id}: runtimeEvidence must be a non-empty array`);
      continue;
    }
    for (const [index, item] of row.runtimeEvidence.entries()) {
      const label = `${row.id}.runtimeEvidence[${index}]`;
      if (!RUNTIME_EVIDENCE_TYPES.has(item?.type)) {
        problems.push(`${label}: invalid type ${String(item?.type)}`);
      }
      if (typeof item?.file !== "string" || item.file.trim() === "") {
        problems.push(`${label}: missing file`);
      }
      for (const field of ["positivePatterns", "negativePatterns"]) {
        if (!Array.isArray(item?.[field]) || item[field].length === 0
          || item[field].some((pattern) => typeof pattern !== "string" || pattern.trim() === "")) {
          problems.push(`${label}: ${field} must be a non-empty string array`);
        }
      }
      if (!RUNTIME_EVIDENCE_TYPES.has(item?.type) || !item?.file) continue;
      let source;
      try { source = readText(item.type, item.file); } catch { source = undefined; }
      if (typeof source !== "string") {
        problems.push(`${label}: missing ${item.type} file ${item.file}`);
        continue;
      }
      const compile = (pattern, polarity) => {
        try { return new RegExp(pattern, "m"); }
        catch { problems.push(`${label}: invalid ${polarity} pattern ${pattern}`); return null; }
      };
      for (const pattern of item.positivePatterns ?? []) {
        const regex = compile(pattern, "positive");
        if (regex && !regex.test(source)) problems.push(`${label}: positive pattern not found: ${pattern}`);
      }
      for (const pattern of item.negativePatterns ?? []) {
        const regex = compile(pattern, "negative");
        if (regex?.test(source)) problems.push(`${label}: negative pattern found: ${pattern}`);
      }
    }
  }
  return problems;
}

function nonEmptyStrings(value) {
  return Array.isArray(value) && value.length > 0
    && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function validateEvidenceSource(label, item, readText, problems) {
  if (typeof item?.type !== "string" || item.type.trim() === "") problems.push(`${label}: missing type`);
  if (typeof item?.file !== "string" || item.file.trim() === "") problems.push(`${label}: missing file`);
  if (!nonEmptyStrings(item?.positivePatterns)) problems.push(`${label}: positivePatterns must be a non-empty string array`);
  if (!item?.type || !item?.file || !nonEmptyStrings(item?.positivePatterns)) return;
  let source;
  try { source = readText(item.type, item.file); } catch { source = undefined; }
  if (typeof source !== "string") {
    problems.push(`${label}: missing ${item.type} file ${item.file}`);
    return;
  }
  for (const pattern of item.positivePatterns) {
    let regex;
    try { regex = new RegExp(pattern, "m"); }
    catch { problems.push(`${label}: invalid positive pattern ${pattern}`); continue; }
    if (!regex.test(source)) problems.push(`${label}: positive pattern not found: ${pattern}`);
  }
  for (const pattern of item.negativePatterns ?? []) {
    let regex;
    try { regex = new RegExp(pattern, "m"); }
    catch { problems.push(`${label}: invalid negative pattern ${pattern}`); continue; }
    if (regex.test(source)) problems.push(`${label}: negative pattern found: ${pattern}`);
  }
}

const CONSUMER_RUNTIME_TYPES = new Set([
  "pc-runtime",
  "backend-runtime",
  "uniapp-runtime",
  "janus-runtime",
]);
const CONSUMER_TEST_TYPES = new Set([
  "test-runtime",
  "backend-test",
  "uniapp-test",
  "janus-test",
]);

function containsAssertionCall(node) {
  let found = false;
  walk(node, (child) => {
    if (found || !ts.isCallExpression(child)) return;
    let expression = child.expression;
    while (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
      expression = expression.expression;
    }
    while (ts.isCallExpression(expression)) expression = expression.expression;
    if (ts.isIdentifier(expression) && /^(?:assert|expect|assertThat|verify)$/.test(expression.text)) found = true;
  });
  return found;
}

function assertionExpressions(source, fileName) {
  const expressions = [];
  const tree = parse(source, fileName);
  walk(tree, (node) => {
    if (ts.isExpressionStatement(node) && containsAssertionCall(node)) expressions.push(node.getText(tree));
  });
  // Java/JUnit and other non-JS tests are not fully parsed by TypeScript. Keep
  // the fallback statement-scoped: outcome text in a comment or unrelated
  // declaration must not count as part of an assertion.
  for (const statement of source.match(/[^;\r\n]*(?:assert[A-Za-z]*|expect|verify)\s*\([^;]*;/g) ?? []) {
    expressions.push(statement);
  }
  return [...new Set(expressions)];
}

/**
 * A runtime consumer contract is deliberately stronger than `runtimeEvidence`.
 * A source symbol or endpoint proves only that code exists; it does not prove
 * that the downstream runtime consumes the producer's value. Pending rows may
 * carry the contract alone. Flipping one to built requires evidence for every
 * declared profile, split into producer, real consumer and behavior-test
 * sources. The behavior test must assert both the success and fail-closed
 * outcome named by the contract.
 */
export function validateRuntimeConsumerContracts(
  manifest,
  readText,
  resolveIdentity = (_type, file) => file.replaceAll("\\", "/"),
) {
  const problems = [];
  for (const row of manifest.rows ?? []) {
    const contract = row.runtimeConsumerContract;
    if (contract === undefined) continue;
    const label = `${row.id}.runtimeConsumerContract`;
    if (!nonEmptyStrings(contract.profiles)) problems.push(`${label}: profiles must be a non-empty string array`);
    for (const field of ["producer", "consumer", "successOutcome", "failureOutcome"]) {
      if (typeof contract[field] !== "string" || contract[field].trim() === "") problems.push(`${label}: missing ${field}`);
    }
    if (row.status !== "built") continue;

    const evidence = row.runtimeConsumerEvidence;
    if (!Array.isArray(evidence) || evidence.length === 0) {
      problems.push(`${row.id}: built runtime consumer contract requires evidence`);
      continue;
    }
    for (const profile of contract.profiles ?? []) {
      const item = evidence.find((candidate) => candidate?.profile === profile);
      if (!item) {
        problems.push(`${row.id}: built runtime consumer contract requires evidence for profile ${profile}`);
        continue;
      }
      for (const part of ["producer", "consumer"]) {
        if (!CONSUMER_RUNTIME_TYPES.has(item[part]?.type)) {
          problems.push(`${row.id}.${profile}: ${part} type ${String(item[part]?.type)} is not an allowed runtime type`);
        }
      }
      if (!CONSUMER_TEST_TYPES.has(item.behaviorTest?.type)) {
        problems.push(`${row.id}.${profile}: behaviorTest must use a test evidence type`);
      }
      if (item.behaviorTest?.file && !/(?:^|\/)(?:tests?|test|spec)\/|(?:\.test|\.spec)\.[cm]?[jt]s$|Test\.java$/i.test(item.behaviorTest.file)) {
        problems.push(`${row.id}.${profile}: behaviorTest file must be a recognizable test source`);
      }
      const identities = [item.producer, item.consumer, item.behaviorTest].map((source) => {
        if (!source?.type || !source?.file) return undefined;
        try { return resolveIdentity(source.type, source.file); } catch { return undefined; }
      });
      if (identities.some((identity) => typeof identity !== "string" || identity.trim() === "")) {
        problems.push(`${row.id}.${profile}: every evidence file must resolve inside its declared workspace root`);
      } else if (new Set(identities.map((identity) => identity.toLowerCase())).size !== identities.length) {
        problems.push(`${row.id}.${profile}: producer, consumer and behaviorTest must resolve to distinct physical files`);
      }
      validateEvidenceSource(`${row.id}.${profile}.producer`, item.producer, readText, problems);
      validateEvidenceSource(`${row.id}.${profile}.consumer`, item.consumer, readText, problems);
      validateEvidenceSource(`${row.id}.${profile}.behaviorTest`, item.behaviorTest, readText, problems);
      if (CONSUMER_TEST_TYPES.has(item.behaviorTest?.type) && item.behaviorTest?.file) {
        let testSource;
        try { testSource = readText(item.behaviorTest.type, item.behaviorTest.file); } catch { testSource = undefined; }
        if (typeof testSource === "string") {
          const assertions = assertionExpressions(testSource, item.behaviorTest.file);
          if (assertions.length === 0) problems.push(`${row.id}.${profile}.behaviorTest: test source has no assertion expression`);
          if (!assertions.some((expression) => expression.includes(contract.successOutcome))) {
            problems.push(`${row.id}.${profile}.behaviorTest: successOutcome must occur inside an assertion expression`);
          }
          if (!assertions.some((expression) => expression.includes(contract.failureOutcome))) {
            problems.push(`${row.id}.${profile}.behaviorTest: failureOutcome must occur inside an assertion expression`);
          }
        }
      }
      const behaviorPatterns = item.behaviorTest?.positivePatterns ?? [];
      if (!behaviorPatterns.includes(contract.successOutcome)) {
        problems.push(`${row.id}.${profile}.behaviorTest: must assert successOutcome ${contract.successOutcome}`);
      }
      if (!behaviorPatterns.includes(contract.failureOutcome)) {
        problems.push(`${row.id}.${profile}.behaviorTest: must assert failureOutcome ${contract.failureOutcome}`);
      }
    }
  }
  return problems;
}
