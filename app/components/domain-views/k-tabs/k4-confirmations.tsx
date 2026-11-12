"use client";

// Original K4 confirmation markup, supplied with the saved facts during recovery.
import { Change, Fact, Facts, IrreversibleTag, Notice, StatusTag } from "@/app/components/rd";
import type { K4User } from "@/lib/admin/k-client";
import type { K4Operation } from "@/lib/admin/k4-command";
import type { ConfirmReq, KCtx } from "./types";
import { ModelDiff, changedCount, editableModel, fmt, modelDiffRows } from "./k4-parts";

export function openK4Confirmation(ctx: KCtx, operation: K4Operation,
  recovery: Pick<ConfirmReq, "getPendingReason" | "blockedReason" | "getPendingValue">,
  submit: (reason: string, value?: string) => Promise<void>) {
  const overview = operation.overview;
  const sourceModel = overview.draft ?? overview.model;
  const activeEdit = editableModel(overview.model);
  const draftRows = overview.draft ? modelDiffRows(activeEdit, editableModel(overview.draft), overview.dimensions) : [];
  const editRows = operation.kind === "draft" ? modelDiffRows(editableModel(sourceModel), {
    weights: operation.input.weights, inputSources: operation.input.inputSources, scoreMappings: operation.input.scoreMappings,
    bandLowMax: operation.input.lowMax, bandHighMin: operation.input.highMin, autoEscalateScore: operation.input.autoEscalateScore,
  }, overview.dimensions) : [];
  const editChanged = changedCount(editRows);
  const nextDraftVersion = overview.draft?.version ?? Math.max(overview.model.version, ...overview.modelHistory.map(model => model.version)) + 1;
  const userFacts = (user: K4User) => (
    <Facts>
      <Fact k="用户">{user.userNo}</Fact>
      <Fact k="现在的有效分">{user.effectiveScore} 分 · {user.bandLabel}{user.overridden ? "（人工改分）" : ""}</Fact>
      <Fact k="系统评分">{user.modelScore} 分 · 规则版本 {user.modelVersion}</Fact>
    </Facts>
  );

  if (operation.kind === "override") {
    const user = operation.user;
    ctx.openConfirm({ briefKind: "judgment",
      errorHandled: true,
      action: `手动改分 · ${user.userNo}`,
      title: "手动改分",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      detail: `把这个用户的风险分从 ${user.effectiveScore} 改成指定分数，马上生效，并记入操作记录。`,
      content: userFacts(user),
      statedBrief: {
        impact: "有效分立即改成新分数，提现审核和提现升级告警按它判断；之后系统评分照常更新，但发布新规则、后台重算都保留这个改分，直到有人点「恢复系统评分」或「全部恢复系统评分」。",
        check: "提交前已核对：分数是 0–100 的整数；这位用户的评分在你打开后没有被别人改过（按版本号核对）。",
      },
      reasonPlaceholder: "写清依据，例如：工单号、核实过的关联证据",
      reason: true,
      input: { label: "新的风险分（0–100）", placeholder: "例如 35", kind: "number", min: 0, max: 100, step: 1,
        validate: (value) => value.trim() === "" ? undefined : /^\d+$/.test(value.trim()) && Number(value) <= 100 ? undefined : "要填 0–100 的整数" },
      okLabel: "确认改分",
      ...recovery,
      run: submit,
    });
  }
  if (operation.kind === "recompute") {
    const user = operation.user;
    ctx.openConfirm({ briefKind: "judgment",
      errorHandled: true,
      action: `恢复系统评分 · ${user.userNo}`,
      title: "恢复系统评分",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      detail: `取消人工改的分，按当前评分规则重新计算。当前分 ${user.effectiveScore}，系统算的分 ${user.modelScore}。`,
      content: <>{userFacts(user)}{overview && <Notice tone="progress">按当前生效的 v{overview.model.version} 重新计算这一位用户，不是恢复成以前存的旧分；没有人工改分时也可以用它马上重算。</Notice>}</>,
      statedBrief: {
        impact: "清除这位用户的人工改分，按当前生效的规则重新计算系统评分，算出的分立即生效。",
        check: "提交前已核对：这位用户的评分在你打开后没有被别人改过（按版本号核对）。",
      },
      reasonPlaceholder: "写清依据，例如：工单号、申诉已核实",
      reason: true,
      okLabel: "确认重算",
      ...recovery,
      run: submit,
    });
  }
  if (operation.kind === "draft") {
    ctx.openActionConfirm({ briefKind: "config",
      action: "保存评分规则草稿",
      title: "保存评分规则草稿",
      effect: <StatusTag tone="neutral" filled>只存草稿，不改线上评分</StatusTag>,
      confirmLabel: "保存草稿",
      detail: `在当前${overview.draft ? "草稿" : "生效规则"}的基础上保存。保存后不影响线上评分，需要超级管理员另外发布。`,
      facts: (
        <Facts>
          <Fact k="保存为">{overview.draft ? `草稿 v${overview.draft.version}（覆盖现在的草稿）` : `新草稿 v${nextDraftVersion}`}</Fact>
          <Fact k="线上">仍按生效的 v{overview.model.version} 评分</Fact>
        </Facts>
      ),
      content: <div className="rd-impact"><p className="rd-impact-title">这次改的 {editChanged} 项（和{overview.draft ? `草稿 v${overview.draft.version}` : `生效 v${overview.model.version}`} 比）</p><ModelDiff rows={editRows} /></div>,
      statedBrief: {
        impact: "只保存草稿，线上评分、用户分数和提现审核都不变；要有发布权限的超级管理员发布后才生效。",
        check: "提交前已核对：五项权重合计 100%，分档线从低到高，自动升级线在 70–100 分且不低于高风险起始分，20 项细则都在范围内、次序正确。",
      },
      reasonPlaceholder: "写清为什么调整，例如：复盘结论、工单号",
      ...recovery,
      run: submit,
    });
  }
  if (operation.kind === "publish") {
    const draft = overview.draft!;
    ctx.openActionConfirm({ briefKind: "judgment",
      action: "发布评分规则草稿",
      title: `发布评分规则 v${draft.version}`,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      confirmLabel: "确认发布",
      detail: `生效模型 v${overview.model.version} → 草稿 v${draft.version}，共改 ${changedCount(draftRows)} 项。`,
      facts: (
        <Facts>
          <Fact k="生效版本"><Change from={`v${overview.model.version}`} to={`v${draft.version}`} /></Fact>
          <Fact k="草稿">{draft.createdBy} 保存于 {draft.createdAt}</Fact>
          <Fact k="评分用户">{fmt(overview.totalUsers)} 人，其中人工改分 {fmt(overview.overrideActive)} 人</Fact>
        </Facts>
      ),
      content: (
        <>
          <div className="rd-impact"><p className="rd-impact-title">发布后改变的配置（{changedCount(draftRows)} 项）</p><ModelDiff rows={draftRows} /></div>
          <Notice tone="progress" title="发布后分数怎么变">
            <p>发布这一刻先按 v{draft.version} 重算最多 200 人，其余由后台每轮最多 200 人继续，进度看页面上的「待重新计算」，没有完成时限保证。</p>
            <p>人工改过的分会保留，只更新这些人的系统评分；不用再点「全部恢复系统评分」，那个操作会清掉所有人工改分。</p>
            <p>已经提交的提现不会重新判断；之后的提现按当时的分数和 v{draft.version} 的自动升级线 {draft.autoEscalateScore} 分转人工审核。</p>
          </Notice>
        </>
      ),
      statedBrief: {
        impact: `v${draft.version} 立即成为生效版本，v${overview.model.version} 自动归档；全部评分用户分批按新规则重算，人工改分保留。`,
        check: "提交前已核对：草稿没有未保存的修改；发布人是有评分规则修改权限的超级管理员（后端会再核一次）。",
      },
      reasonPlaceholder: "写清发布依据，例如：复盘结论、审批记录号",
      ...recovery,
      run: submit,
    });
  }
  if (operation.kind === "restore") {
    const model = operation.model;
    ctx.openActionConfirm({ briefKind: "config",
    action: `把旧版本 v${model.version} 恢复为草稿`,
    title: `把 v${model.version} 恢复为草稿`,
    effect: <StatusTag tone="neutral" filled>只改草稿，不改线上评分</StatusTag>,
    confirmLabel: "恢复为草稿",
    detail: `用 v${model.version} 覆盖当前草稿，线上的 v${overview.model.version} 不变；恢复后还要核对并发布才会生效。`,
    facts: (
      <Facts>
        <Fact k="恢复的版本">v{model.version} · {model.createdBy} 起草于 {model.createdAt}</Fact>
        <Fact k="现在的草稿">{overview.draft ? `v${overview.draft.version}，会被 v${model.version} 的配置覆盖` : "没有，恢复后生成新草稿"}</Fact>
        <Fact k="线上">仍按生效的 v{overview.model.version} 评分</Fact>
      </Facts>
    ),
    content: <div className="rd-impact"><p className="rd-impact-title">恢复后草稿和生效 v{overview.model.version} 的差别</p><ModelDiff rows={modelDiffRows(activeEdit, editableModel(model), overview.dimensions)} /></div>,
    statedBrief: {
      impact: `把 v${model.version} 的权重、参与评分、20 项细则和分档线复制成草稿；线上 v${overview.model.version} 不变，之后还要核对并发布才生效。`,
      check: "提交前已核对：页面没有未保存的修改。",
    },
    reasonPlaceholder: "写清为什么恢复旧版本",
      ...recovery,
      run: submit,
    });
  }
  if (operation.kind === "batch") {
    ctx.openActionConfirm({ briefKind: "judgment",
    action: "重新计算所有用户的风险分",
    title: "全部恢复系统评分",
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>人工改分全部清除</IrreversibleTag></>,
    confirmTone: "danger",
    confirmLabel: "确认全部重算",
    detail: `按当前评分规则 v${overview.model.version} 重新计算 ${overview.totalUsers} 个用户的风险分，人工改过的分会被清除。手动一次最多 1000 人。`,
    facts: (
      <Facts>
        <Fact k="评分用户" lead unit="人">{fmt(overview.totalUsers)}</Fact>
        <Fact k="规则版本">按生效的 v{overview.model.version} 计算</Fact>
        <Fact k="人工改分" tone={overview.overrideActive > 0 ? "warn" : undefined}>{overview.overrideActive > 0 ? `${fmt(overview.overrideActive)} 人的人工改分会被清除` : "现在没有生效的人工改分"}</Fact>
      </Facts>
    ),
    content: <Notice tone="warn">在这一次请求里把全部评分用户算完才返回（最多 1000 人），人数多时要等一会儿；有一人算失败整次都不生效。评分历史和人工改分记录保留，但改分不再生效。</Notice>,
    statedBrief: {
      impact: `当前全部评分用户按 v${overview.model.version} 重新计算并清除人工改分，新分数立即生效。`,
      check: "提交前已核对：评分用户不超过 1000 人；后端按提交那一刻的实际名单再核一次，名单变了会拒绝。",
    },
    reasonPlaceholder: "写清为什么要全部重算",
      ...recovery,
      run: submit,
    });
  }
}
