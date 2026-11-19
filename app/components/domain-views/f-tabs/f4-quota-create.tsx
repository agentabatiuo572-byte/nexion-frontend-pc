"use client";

/**
 * F4 购机名额「新建档位」确认框。一个商品最多一个名额档位：已经有档位的商品不在可选范围里，要改就去它的「调额度」。
 * 新建要另一位管理员批准，批准后才加进名额表；批准前普通购机完全不受影响。
 */
import { useEffect, useState } from "react";
import { fetchE1Products } from "@/lib/admin/e1-client";
import { Fact, Facts, Notice, StatusTag } from "@/app/components/rd";
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

export function F4QuotaCreate({ data, ctx, onClose }: { data: F4LeadershipPoolOverview; ctx: FViewCtx; onClose: () => void }) {
  const [products, setProducts] = useState<Awaited<ReturnType<typeof fetchE1Products>>["skus"]>([]);
  useEffect(() => {
    let active = true;
    void fetchE1Products().then(({ skus }) => { if (active) setProducts(skus); }).catch(() => {
      if (active) setProducts([]);
    });
    return () => { active = false; };
  }, []);
  const skuOptions = products.filter(sku => sku.status === "on" && sku.publishBlocked === false && sku.price > 0
    && (sku.inventoryMode === "UNLIMITED" || Number(sku.stock) > 0)).map(sku => sku.id);
  const skuLabels = Object.fromEntries(products.map(sku => [sku.id, sku.name]));
  const taken = new Set(data.quotaRows.map(row => row.productNo).filter(Boolean));
  const free = skuOptions.filter(sku => !taken.has(sku));
  const takenNames = data.quotaRows.filter(row => row.productNo).map(row => skuLabels[row.productNo] ?? row.name ?? row.productNo);
  const noSkus = !skuOptions.length;
  return (
    <OperationConfirmModal briefKind="config"
      action="购机名额 · 新建档位" title="新建购机名额档位"
      detail={<>新建要{APPROVER}批准，批准后才生效。</>}
      effect={<StatusTag tone="progress" filled explain={`${APPROVER}批准后才加上这一档，提交人不能批自己的；批准前这个商品照常卖，不受名额限制。`}>批准后生效</StatusTag>}
      facts={<Facts>
        <Fact k="谁来批">{`${APPROVER}，不能是提交人`}</Fact>
        <Fact k="需有权限">购机名额修改权限</Fact>
      </Facts>}
      content={!noSkus && takenNames.length > 0 ? <Notice tone="neutral" title="一个商品只能有一个名额档位">{`${takenNames.join("、")} 已经有档位，不在下面的可选范围里；要改，到它那一行点「调额度」。`}</Notice> : undefined}
      blockedReason={noSkus ? "商品清单没读到，暂时选不了商品；刷新这页后再试" : !free.length ? "在售商品都已经有名额档位" : undefined}
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
          const problem = issue(values);
          return problem ? { invalid: true, ...problem } : { invalid: false, message: "" };
        },
        fields: [
          { key: "productNo", label: "商品", inputKind: "select", options: free, optionLabels: skuLabels, mustChoose: true, searchable: free.length > 8, current: "", wide: true },
          { key: "name", label: "名称", inputKind: "text", current: "", placeholder: "例如 Pro 月名额", help: "只在后台显示", maxLength: 128, wide: true },
          { key: "directRefs", label: "有效直接邀请（人）", inputKind: "number", current: "0", min: 0, step: 1, help: "填 0 表示不要求" },
          { key: "monthComputePoints", label: "本月团队算力点", inputKind: "number", current: "0", min: 0, step: 1, help: "填 0 表示不要求" },
          { key: "unlockMode", label: "两项条件", inputKind: "select", options: ["ALL", "EITHER"], optionLabels: MODE_LABELS, segments: true, current: "ALL", help: "两项都填了才有区别" },
          { key: "monthlyQuota", label: "每月名额（台）", inputKind: "number", current: "", min: 0, max: 1000000, step: 1, placeholder: "例如 100", help: "0–1,000,000 的整数" },
        ],
      }}
      onClose={onClose}
      onConfirm={async (reason, _value, values) => {
        const productNo = values?.productNo;
        if (!productNo || !skuOptions.includes(productNo)) throw new Error("F4_QUOTA_SKU_NOT_SELLABLE");
        if (taken.has(productNo)) throw new Error(QUOTA_CREATE_TAKEN);
        const problem = issue(values);
        if (problem) throw new Error(problem.message);
        try {
          await ctx.submitF4Proposal(`f4-quota-create:${productNo}`, {
            action: "新增购机名额档位", obj: productNo, before: "不存在", after: values.name.trim(),
            type: "param", gate: { roles: [] }, gateLabel: APPROVER, reason, sourceDomain: "F4",
            command: { domain: "F", op: "f4_quota_tier_create", params: { values: {
              quotaCode: `quota-${crypto.randomUUID().replaceAll("-", "").slice(0, 26)}`,
              productNo, displayName: values.name.trim(), directRefs: Number(values.directRefs),
              monthComputePoints: Number(values.monthComputePoints), monthlyQuota: Number(values.monthlyQuota),
              unlockMode: values.unlockMode, status: 1, sortOrder: 0,
            } } },
            target: { domain: "F", type: "hardware_quota_tier", id: productNo },
          });
        } catch (error) {
          if ((error as { backendMessage?: string }).backendMessage === "F4_QUOTA_SKU_EXISTS") throw new Error(QUOTA_CREATE_TAKEN);
          throw error;
        }
        onClose();
        await ctx.refreshF4();
      }} />
  );
}
