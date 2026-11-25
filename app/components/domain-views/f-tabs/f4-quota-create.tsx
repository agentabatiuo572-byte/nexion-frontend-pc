"use client";

/**
 * F4 购机名额「新建档位」确认框。一个商品最多一个名额档位：已经有档位的商品不在可选范围里，要改就去它的「调额度」。
 * 新建要另一位管理员批准，批准后才加进名额表；批准前普通购机完全不受影响。
 */
import { F_APPROVAL_PERMISSION_NAMES, fApprovalPermissionText } from "@/lib/admin/f-approval-names";
import { useEffect, useRef, useState } from "react";
import { f4ProposalRecovery, listF4Proposals } from "@/lib/admin/f4-approval";
import type { FDomainAttempt } from "@/lib/admin/f2-approval";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fConfirmRecovery } from "./f-recovery-state";
import { fetchE1Products } from "@/lib/admin/e1-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { Explain, Fact, Facts, Notice, StatusTag } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import type { F4LeadershipPoolOverview } from "@/lib/admin/f1-client";
import { count } from "./f4-shared";
import type { FViewCtx } from "./types";

export const QUOTA_CREATE_TAKEN = "这个商品已经有名额档位，不能再建；要改名额，到它那一行点「调额度」。";
const APPROVER = "另一位超级管理员";
const MODE_LABELS: Record<string, string> = { ALL: "两项都要满足", EITHER: "满足一项就行" };
const WHOLE = /^(?:0|[1-9]\d{0,11})$/;

function issue(values: Record<string, string>): { field: string; message: string } | undefined {
  if (!values.productNo) return { field: "productNo", message: "请选择商品" };
  if (!values.name.trim()) return { field: "name", message: "请填写名称" };
  if (values.name.trim().length > 128) return { field: "name", message: "名称最多 128 个字符" };
  if (!WHOLE.test(values.directRefs.trim()) || Number(values.directRefs) > 2147483647) return { field: "directRefs", message: "有效直接邀请填 0 起的整数" };
  if (!WHOLE.test(values.monthComputePoints.trim())) return { field: "monthComputePoints", message: "本月团队算力点填 0 起的整数" };
  if (!WHOLE.test(values.monthlyQuota.trim()) || Number(values.monthlyQuota) > 1000000) return { field: "monthlyQuota", message: "每月名额为 0–1,000,000 台的整数" };
}

/** 资格条件写成和名额卡一样的一句话。 */
function conditionText(values: Record<string, string>) {
  const parts: string[] = [];
  if (WHOLE.test(values.directRefs.trim()) && Number(values.directRefs) > 0) parts.push(`有效直接邀请 ≥ ${count(Number(values.directRefs))}`);
  if (WHOLE.test(values.monthComputePoints.trim()) && Number(values.monthComputePoints) > 0) parts.push(`本月团队算力点 ≥ ${count(Number(values.monthComputePoints))}`);
  if (!parts.length) return "买的人不用满足额外条件";
  return `买的人要满足：${parts.join(values.unlockMode === "EITHER" ? " 或 " : " 且 ")}`;
}

function quotaRequest(original?: FDomainAttempt) {
  return original?.request?.command.params.values as Record<string, unknown> | undefined;
}

function quotaValues(original?: FDomainAttempt) {
  const frozen = quotaRequest(original);
  if (!frozen || typeof frozen.productNo !== "string") return undefined;
  return {
    productNo: frozen.productNo, name: String(frozen.displayName), directRefs: String(frozen.directRefs),
    monthComputePoints: String(frozen.monthComputePoints), monthlyQuota: String(frozen.monthlyQuota), unlockMode: String(frozen.unlockMode),
  };
}

export function F4QuotaCreate({ data, ctx, onClose, original, draft }: { data?: F4LeadershipPoolOverview; ctx: FViewCtx; onClose: () => void; original?: FDomainAttempt; draft?: FDomainAttempt }) {
  const owner = useAdminAuth(state => state.session?.adminId);
  const attempt = useRef<{ slot: string; quotaCode: string } | undefined>(undefined);
  const lookup = () => owner === undefined ? [] : listF4Proposals(owner);
  const record = () => lookup().find(row => original ? row.commandKey === original.commandKey
    : attempt.current?.slot === row.fingerprint && quotaRequest(row)?.quotaCode === attempt.current.quotaCode);
  const frozenValues = quotaValues(record() ?? original);
  const frozenProduct = frozenValues?.productNo;
  const draftValues = quotaValues(draft);
  const [products, setProducts] = useState<Awaited<ReturnType<typeof fetchE1Products>>["skus"]>([]);
  const [catalogError, setCatalogError] = useState<string>();
  useEffect(() => {
    if (original) return;
    let active = true;
    void fetchE1Products().then(({ skus }) => { if (active) setProducts(skus); }).catch(error => {
      if (active) setCatalogError(displayAdminError(error));
    });
    return () => { active = false; };
  }, [original]);
  const skuOptions = products.filter(sku => sku.status === "on" && sku.publishBlocked === false && sku.price > 0
    && (sku.inventoryMode === "UNLIMITED" || Number(sku.stock) > 0)).map(sku => sku.id);
  const skuLabels = Object.fromEntries(products.map(sku => [sku.id, sku.name]));
  const taken = new Set((data?.quotaRows ?? []).map(row => row.productNo).filter(Boolean));
  const pendingSkus = new Set([
    ...ctx.f4Proposals.filter(entry => entry.fingerprint.startsWith("f4-quota-create:"))
      .map(entry => entry.fingerprint.slice("f4-quota-create:".length)),
    ...ctx.f4ApprovalRows.filter(row => row.operationCode === "f4_quota_tier_create" && row.status === "pending").map(row => row.obj),
  ]);
  const eligible = skuOptions.filter(sku => !taken.has(sku) && !pendingSkus.has(sku));
  const fixedProduct = frozenProduct ?? draftValues?.productNo;
  const free = fixedProduct ? [fixedProduct] : eligible;
  const takenNames = (data?.quotaRows ?? []).filter(row => row.productNo).map(row => skuLabels[row.productNo] ?? row.name ?? row.productNo);
  const noSkus = !skuOptions.length;
  const draftBlocked = draftValues && !eligible.includes(draftValues.productNo)
    ? "原商品当前不能新建名额档位，请核对商品和名额列表。" : undefined;
  return (
    <OperationConfirmModal briefKind="config"
      action="购机名额 · 新建档位" title="新建购机名额档位"
      detail={<>新建要{APPROVER}批准，批准后才生效。</>}
      effect={<StatusTag tone="progress" filled explain={`${APPROVER}批准后才加上这一档，提交人不能批自己的；批准前这个商品照常卖，不受名额限制。`}>批准后生效</StatusTag>}
      facts={<Facts>
        <Fact k="谁来批">{`${APPROVER}，不能是提交人`}</Fact>
        <Fact k="需有权限">{fApprovalPermissionText(F_APPROVAL_PERMISSION_NAMES.network_f4_write)}</Fact>
      </Facts>}
      content={!noSkus && takenNames.length > 0 ? <Notice tone="neutral" title="一个商品只能有一个名额档位">{`${takenNames.length} 个商品已有档位。`}<span className="rd-keep">要改，到它那一行点「调额度」。</span><Explain label="已有档位的商品" content={takenNames.join("、")} /></Notice> : undefined}
      getPendingReason={() => record()?.request?.reason}
      getPendingBusinessValue={() => quotaValues(record() ?? original) ?? draftValues}
      getPendingRecovery={() => {
        const saved = record();
        return saved && fConfirmRecovery(f4ProposalRecovery, saved, async () => {
          if (await ctx.recoverF4({ kind: "proposal", original: saved }, "query")) onClose();
        });
      }}
      blockedReason={original ? undefined : draftBlocked ?? (catalogError ? !ctx.can("device_e1_read") ? "需要商品查看权限才能选商品，请联系管理员开通" : catalogError : (noSkus ? "商品清单没读到，暂时选不了商品；刷新这页后再试" : !free.length ? pendingSkus.size ? "可选商品有原操作待核对，请从原操作记录继续。" : "在售商品都已经有名额档位" : undefined))}
      statedBrief={(values) => ({
        impact: values.productNo && WHOLE.test((values.monthlyQuota ?? "").trim())
          ? `批准后 ${skuLabels[values.productNo] ?? values.productNo} 每月最多卖 ${count(Number(values.monthlyQuota))} 台，${conditionText(values)}；批准前照常卖，不受限制。`
          : "批准后这个商品每月限量卖，买的人要满足填的资格条件；批准前照常卖，不受限制。",
        check: "核对商品、资格条件和每月名额；理由写清依据或工单号。",
      })}
      confirmLabel="提交审批" reasonPlaceholder="例如：活动方案或工单号"
      businessFormRevision={products.length}
      businessForm={{
        kind: "multi-field",
        feedback: values => {
          const related = values.productNo && lookup().find(row => row.fingerprint === `f4-quota-create:${values.productNo}`);
          const problem = related && !record() ? { field: "productNo", message: isRetryExpired(related) ? RETRY_EXPIRED_TEXT : "这个商品有原操作待核对，请从原操作记录继续。" } : issue(values);
          return problem ? { invalid: true, ...problem } : { invalid: false, message: "" };
        },
        fields: [
          { key: "productNo", label: "商品", inputKind: "select", options: free, optionLabels: skuLabels, mustChoose: true, searchable: free.length > 8, current: "" },
          { key: "name", label: "名称", inputKind: "text", current: "", placeholder: "例如 Pro 月名额", help: "只在后台显示", maxLength: 128 },
          { key: "directRefs", label: "有效直接邀请（人）", inputKind: "number", current: "0", min: 0, step: 1, help: "填 0 表示不要求" },
          { key: "monthComputePoints", label: "本月团队算力点", inputKind: "number", current: "0", min: 0, step: 1, help: "填 0 表示不要求" },
          { key: "unlockMode", label: "两项条件", inputKind: "select", options: ["ALL", "EITHER"], optionLabels: MODE_LABELS, segments: true, current: "ALL", help: "两项都填了才有区别" },
          { key: "monthlyQuota", label: "每月名额（台）", inputKind: "number", current: "", min: 0, max: 1000000, step: 1, placeholder: "例如 100", help: "0–1,000,000 的整数" },
        ],
      }}
      onClose={onClose}
      onConfirm={async (reason, _value, values) => {
        const saved = record();
        if (saved) {
          await ctx.recoverF4({ kind: "proposal", original: saved }, "retry");
          onClose();
          return;
        }
        if (original) throw new Error("PENDING_REPLAY_BLOCKED");
        if (draftBlocked) throw new Error(draftBlocked);
        const productNo = values?.productNo;
        if (draft && productNo !== draftValues?.productNo) throw new Error("请从原草稿继续处理同一商品。");
        if (!productNo || !skuOptions.includes(productNo)) throw new Error("F4_QUOTA_SKU_NOT_SELLABLE");
        if (taken.has(productNo)) throw new Error(QUOTA_CREATE_TAKEN);
        const problem = issue(values);
        if (problem) throw new Error(problem.message);
        const slot = `f4-quota-create:${productNo}`;
        const related = lookup().find(row => row.fingerprint === slot);
        if (related) throw new Error(isRetryExpired(related) ? RETRY_EXPIRED_TEXT : "这个商品有原操作待核对，请从原操作记录继续。");
        if (pendingSkus.has(productNo)) throw new Error("这个商品已有待审批的名额申请。");
        const quotaCode = `quota-${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`;
        attempt.current = { slot, quotaCode };
        try {
          await ctx.submitF4Proposal(slot, {
            action: "新增购机名额档位", obj: productNo, before: "不存在", after: values.name.trim(),
            type: "param", gate: { roles: [] }, gateLabel: APPROVER, reason, sourceDomain: "F4",
            command: { domain: "F", op: "f4_quota_tier_create", params: { values: {
              quotaCode,
              productNo, displayName: values.name.trim(), directRefs: Number(values.directRefs),
              monthComputePoints: Number(values.monthComputePoints), monthlyQuota: Number(values.monthlyQuota),
              unlockMode: values.unlockMode, status: 1, sortOrder: 0,
            } } },
            target: { domain: "F", type: "hardware_quota_tier", id: productNo },
          }, data ? { action: "quota-create", overview: data, policy: null, businessValue: values, continuedFrom: draft?.commandKey } : undefined);
        } catch (error) {
          if ((error as { backendMessage?: string }).backendMessage === "F4_QUOTA_SKU_EXISTS") throw new Error(QUOTA_CREATE_TAKEN);
          throw error;
        }
        onClose();
        await ctx.refreshF4();
      }} />
  );
}
