"use client";

import { useEffect, useState } from "react";
import { displayAdminError, guardedFetch } from "@/lib/admin/error-messages";

type Observation = {
  runId: string;
  source: "mock";
  sourceEnvironment: "SANDBOX";
  permanentLabel: string;
  progress: unknown[];
  rewards: unknown[];
  idempotency: unknown[];
  productionDelta: {
    status: "VERIFIED_ZERO" | "VIOLATION" | "INSUFFICIENT";
    progress?: number;
    event?: number;
    reward?: number;
    earningsRelease?: number;
    walletLedger?: number;
    outbox?: number;
    adminIdempotency?: number;
    catalogVersion?: number;
    catalogAdminIdempotency?: number;
    catalogAudit?: number;
    catalogOutbox?: number;
  };
};

type CommandReceipt = { committed: boolean; succeeded: boolean; status: "COMPLETED"; code: number; message: string };
const proofLabel = "ACCEPTANCE SANDBOX • NON-PRODUCTION";
const deltaFields = ["progress", "event", "reward", "earningsRelease", "walletLedger", "outbox", "adminIdempotency", "catalogVersion", "catalogAdminIdempotency", "catalogAudit", "catalogOutbox"] as const;

function validateObservation(value: unknown, runId: string): Observation {
  if (!value || typeof value !== "object") throw new Error("LEARNING_ACCEPTANCE_PROOF_INVALID");
  const candidate = value as Partial<Observation>;
  if (candidate.runId !== runId || candidate.source !== "mock" || candidate.sourceEnvironment !== "SANDBOX" || candidate.permanentLabel !== proofLabel
    || !candidate.productionDelta || candidate.productionDelta.status !== "VERIFIED_ZERO"
    || deltaFields.some(field => candidate.productionDelta?.[field] !== 0)) {
    throw new Error("LEARNING_ACCEPTANCE_PROOF_INVALID");
  }
  return candidate as Observation;
}

function successfulReceipt(payload: unknown): payload is { code: 0; data: CommandReceipt } {
  if (!payload || typeof payload !== "object") return false;
  const outer = payload as { code?: unknown; data?: Partial<CommandReceipt> };
  return outer.code === 0 && outer.data?.committed === true && outer.data?.succeeded === true
    && outer.data.status === "COMPLETED" && outer.data.code === 0;
}

function failedReceipt(payload: unknown): payload is { code: 0; data: CommandReceipt } {
  if (!payload || typeof payload !== "object") return false;
  const outer = payload as { code?: unknown; data?: Partial<CommandReceipt> };
  return outer.code === 0 && outer.data?.committed === true && outer.data?.succeeded === false
    && outer.data.status === "COMPLETED" && typeof outer.data.code === "number";
}

/** Acceptance proof plus the only run-scoped catalog mutation surface; it never renders production facts. */
export default function LearningAcceptanceObservationPage() {
  const [state, setState] = useState<Observation | null>(null);
  const [error, setError] = useState("");
  const [catalogMessage, setCatalogMessage] = useState("");
  useEffect(() => {
    const runId = process.env.NEXT_PUBLIC_NEXION_ACCEPTANCE_RUN_ID;
    if (!runId) { setError("NEXION_ACCEPTANCE_RUN_ID_REQUIRED"); return; }
    guardedFetch(`/api/admin/content/learning-acceptance/observation?runId=${encodeURIComponent(runId)}`, { cache: "no-store" })
      .then(async response => { const payload = await response.json(); if (!response.ok || payload?.code) throw new Error(payload?.message || "LEARNING_ACCEPTANCE_OBSERVATION_UNAVAILABLE"); return payload.data as Observation; })
      .then(value => setState(validateObservation(value, runId)))
      .catch(cause => setError(displayAdminError(cause)));
  }, []);
  const publishSandboxCourse = async () => {
    const runId = process.env.NEXT_PUBLIC_NEXION_ACCEPTANCE_RUN_ID;
    if (!runId) { setCatalogMessage("NEXION_ACCEPTANCE_RUN_ID_REQUIRED"); return; }
    const courseId = "acceptance-course";
    const stableKey = (operation: string) => {
      const storageKey = `learning-acceptance:${runId}:${operation}`;
      const prior = localStorage.getItem(storageKey);
      if (prior) return prior;
      const created = `learning-sandbox-${operation}-${crypto.randomUUID()}`;
      localStorage.setItem(storageKey, created);
      return created;
    };
    const saveKey = stableKey("save");
    const publishKey = stableKey("publish");
    const draft = { titleZh: "验收课程", titleEn: "Acceptance course", titleVi: "Khoá học nghiệm thu", bodyZh: "仅用于验收的隔离课程。", bodyEn: "Isolated acceptance course.", bodyVi: "Khoá học cô lập.", category: "Acceptance", format: "Article", difficulty: "Beginner", rewardNex: 1, duration: "1 min", version: "v1", quizQuestions: [] };
    try {
      const save = await guardedFetch(`/api/admin/content/learning-acceptance/catalog/${courseId}?runId=${encodeURIComponent(runId)}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": saveKey }, body: JSON.stringify(draft) });
      const savePayload = await save.json(); if (!save.ok || savePayload?.code) throw new Error(savePayload?.message || "LEARNING_SANDBOX_CATALOG_SAVE_FAILED");
      const revision = savePayload?.data?.revision;
      if (!Number.isInteger(revision) || revision < 0) throw new Error("LEARNING_SANDBOX_CATALOG_REVISION_UNAVAILABLE");
      const publish = await guardedFetch(`/api/admin/content/learning-acceptance/catalog/${courseId}/versions/v1/publish?runId=${encodeURIComponent(runId)}&expectedRevision=${revision}`, { method: "POST", headers: { "Idempotency-Key": publishKey } });
      const publishPayload = await publish.json(); if (!publish.ok || publishPayload?.code) throw new Error(publishPayload?.message || "LEARNING_SANDBOX_CATALOG_PUBLISH_FAILED");
      const proof = await guardedFetch(`/api/admin/content/learning-acceptance/catalog?runId=${encodeURIComponent(runId)}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null);
      const published = proof?.data?.some((course: { courseId?: string; version?: string; status?: string }) => course.courseId === courseId && course.version === "v1" && course.status === "PUBLISHED");
      if (!published) throw new Error("LEARNING_SANDBOX_CATALOG_PUBLISH_PROOF_MISSING");
      setCatalogMessage("Sandbox course published for this Run; durable receipt and authoritative catalog confirm App visibility.");
    } catch (cause) {
      const receiptFor = (key: string, commandScope: string) => guardedFetch(`/api/admin/content/learning-acceptance/catalog/command-result?runId=${encodeURIComponent(runId)}&commandScope=${encodeURIComponent(commandScope)}&idempotencyKey=${encodeURIComponent(key)}`, { cache: "no-store" })
        .then(response => response.ok ? response.json() : null).catch(() => null);
      const saveReceipt = await receiptFor(saveKey, `LEARNING_SANDBOX_COURSE_SAVE:${courseId}`);
      const publishReceipt = await receiptFor(publishKey, `LEARNING_SANDBOX_COURSE_PUBLISH:${courseId}:v1`);
      const proof = await guardedFetch(`/api/admin/content/learning-acceptance/catalog?runId=${encodeURIComponent(runId)}`, { cache: "no-store" }).then(response => response.ok ? response.json() : null).catch(() => null);
      const published = proof?.data?.some((course: { courseId?: string; version?: string; status?: string }) => course.courseId === courseId && course.version === "v1" && course.status === "PUBLISHED");
      if (successfulReceipt(publishReceipt) && published) {
        setCatalogMessage("Sandbox course publish confirmed by durable command receipt and authoritative catalog readback.");
        return;
      }
      if (failedReceipt(publishReceipt)) {
        localStorage.removeItem(`learning-acceptance:${runId}:publish`);
        setCatalogMessage(`${publishReceipt.data.code} ${publishReceipt.data.message}`);
        return;
      }
      if (failedReceipt(saveReceipt)) {
        localStorage.removeItem(`learning-acceptance:${runId}:save`);
        setCatalogMessage(`${saveReceipt.data.code} ${saveReceipt.data.message}`);
        return;
      }
      if (successfulReceipt(saveReceipt)) {
        setCatalogMessage("Sandbox course draft confirmed; publish result remains unknown and will retain its key for readback.");
        return;
      }
      setCatalogMessage(displayAdminError(cause));
    }
  };
  return <main style={{ padding: 24 }}><h1>Learning acceptance observation</h1>
    <p>Permanent acceptance-only proof. It is not a production course dashboard.</p>
    {error && <p role="alert">{error}</p>}
    {state && <><p>{state.permanentLabel} · {state.source}/{state.sourceEnvironment} · Run {state.runId}</p>
      {state.productionDelta.status === "VERIFIED_ZERO"
        ? <p>Production delta verified zero — progress {state.productionDelta.progress}, event {state.productionDelta.event}, reward {state.productionDelta.reward}, earnings release {state.productionDelta.earningsRelease}, wallet ledger {state.productionDelta.walletLedger}, outbox {state.productionDelta.outbox}, admin idempotency {state.productionDelta.adminIdempotency}, catalog version {state.productionDelta.catalogVersion}, catalog admin idempotency {state.productionDelta.catalogAdminIdempotency}, catalog audit {state.productionDelta.catalogAudit}, catalog outbox {state.productionDelta.catalogOutbox}</p>
        : <p role="alert">Production delta {state.productionDelta.status} — progress {state.productionDelta.progress ?? "unknown"}, event {state.productionDelta.event ?? "unknown"}, reward {state.productionDelta.reward ?? "unknown"}, earnings release {state.productionDelta.earningsRelease ?? "unknown"}, wallet ledger {state.productionDelta.walletLedger ?? "unknown"}, outbox {state.productionDelta.outbox ?? "unknown"}, admin idempotency {state.productionDelta.adminIdempotency ?? "unknown"}, catalog version {state.productionDelta.catalogVersion ?? "unknown"}, catalog admin idempotency {state.productionDelta.catalogAdminIdempotency ?? "unknown"}, catalog audit {state.productionDelta.catalogAudit ?? "unknown"}, catalog outbox {state.productionDelta.catalogOutbox ?? "unknown"}</p>}
      <pre aria-label="run-scoped-learning-progress">{JSON.stringify(state.progress, null, 2)}</pre>
      <pre aria-label="run-scoped-learning-rewards">{JSON.stringify(state.rewards, null, 2)}</pre>
      <pre aria-label="run-scoped-learning-idempotency">{JSON.stringify(state.idempotency, null, 2)}</pre>
    </>}
    <section aria-label="sandbox-course-catalog"><h2>Run-scoped sandbox course catalog</h2>
      <p>Creates and publishes only <code>mock/SANDBOX</code> course definitions for this Run; it cannot mutate the production catalog.</p>
      <button type="button" onClick={publishSandboxCourse}>Publish acceptance course</button>
      {catalogMessage && <p role="status">{catalogMessage}</p>}
    </section>
  </main>;
}
