// Runtime action sampler for one admin L1 shard.
// It re-opens each route for each sampled business button, clicks one
// representative occurrence, and records whether the UI changed observably.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(ROOT, "docs", "audit");
const SHARDS = path.join(AUDIT, "shards");
const SCREENSHOTS = path.join(AUDIT, "screenshots");
const BASE_URL = process.env.ADMIN_BASE_URL || "http://localhost:3002";
const shardId = process.argv[2] || "AD-09";
const maxActionsPerRoute = Number(process.env.ACTION_SAMPLE_LIMIT || 8);
const session = process.env.AGENT_BROWSER_SESSION || `nexion-actions-${shardId.toLowerCase()}`;

const ACTION_RE =
  /发布|新版|草拟|编辑|修复|扫描|重扫|预览|复制|删除|保存|发送|同步|回滚|创建|新建|导出|下发|下架|开启|关闭|审核|审查|生成|暂停|恢复|应用|确认|拒绝|批准|驳回|改角色|改权限|变更|调整|冻结|解冻|启用|禁用|重置|分配|授权|撤销/;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function quoteShellArg(arg) {
  const value = String(arg);
  if (process.platform === "win32") return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function isTransientAgentBrowserFailure(result) {
  const output = `${result.error?.message || ""}\n${result.stdout || ""}\n${result.stderr || ""}`;
  return /Failed to connect|ECONNREFUSED|actively refused|积极拒绝|daemon may be busy|busy or unresponsive/i.test(output);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(args, options = {}) {
  const fullArgs = ["--session", session, ...args];
  const attempts = options.retries ?? 3;
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result =
      process.platform === "win32"
        ? spawnSync(["agent-browser", ...fullArgs.map(quoteShellArg)].join(" "), [], {
            cwd: ROOT,
            encoding: "utf8",
            input: options.input,
            shell: true,
            timeout: options.timeout || 30000,
          })
        : spawnSync("agent-browser", fullArgs, {
            cwd: ROOT,
            encoding: "utf8",
            input: options.input,
            timeout: options.timeout || 30000,
          });
    if (result.status === 0 || !isTransientAgentBrowserFailure(result) || attempt === attempts) break;
    sleepSync(500 * attempt);
  }
  if (result.status !== 0) {
    throw new Error(
      `agent-browser ${args.join(" ")} failed` +
        `\nstatus=${result.status}` +
        `\nerror=${result.error?.message || ""}` +
        `\nstdout=${result.stdout || ""}` +
        `\nstderr=${result.stderr || ""}`,
    );
  }
  return `${result.stdout || ""}${result.stderr || ""}`.trim();
}

function evalJson(script) {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const raw = run(["eval", "-b", encoded], { timeout: 30000 });
  try {
    return JSON.parse(JSON.parse(raw));
  } catch {
    try {
      return JSON.parse(raw);
    } catch (error) {
      return { parseError: error.message, raw };
    }
  }
}

function safeName(value) {
  return (
    value
      .replace(/^\/+/, "")
      .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
      .replace(/[^a-zA-Z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "root"
  );
}

function hashText(text) {
  return createHash("sha256").update(text || "").digest("hex").slice(0, 16);
}

function lineJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`, "utf8");
}

function probe() {
  const data = evalJson(`JSON.stringify((() => {
    const text = (el) => (el.innerText || el.textContent || '').trim();
    const bodyText = document.body.innerText || '';
    const controlInfo = (el) => {
      const id = el.getAttribute('id') || '';
      const explicitLabel = id ? text(document.querySelector('label[for="' + CSS.escape(id) + '"]') || document.createElement('span')) : '';
      const wrappingLabel = text(el.closest('label') || document.createElement('span'));
      const nearby = text(el.parentElement || document.createElement('span')).slice(0, 180);
      return {
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        placeholder: el.getAttribute('placeholder') || '',
        aria: el.getAttribute('aria-label') || '',
        label: explicitLabel || wrappingLabel,
        nearby,
        value: el.value || '',
        options: el.tagName.toLowerCase() === 'select' ? Array.from(el.options).map((option) => text(option) || option.value) : [],
      };
    };
    const dialogEls = Array.from(document.querySelectorAll('[role="dialog"],[aria-modal="true"],.modal,.drawer,.scrim'));
    const dialogs = dialogEls.map((el) => text(el).slice(0, 900));
    const dialogDetails = dialogEls.map((el) => ({
      text: text(el).slice(0, 1600),
      controls: Array.from(el.querySelectorAll('input,textarea,select,[role="combobox"],[role="listbox"],[role="radio"],[role="checkbox"]')).map(controlInfo),
      buttons: Array.from(el.querySelectorAll('button')).map((button) => ({
        text: text(button),
        disabled: Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true'),
      })).filter((button) => button.text),
    }));
    const fixedTexts = Array.from(document.querySelectorAll('div,section,aside')).filter((el) => getComputedStyle(el).position === 'fixed').map(text).filter(Boolean).slice(0, 20);
    const formControls = Array.from(document.querySelectorAll('input,textarea,select')).map(controlInfo);
    const buttons = Array.from(document.querySelectorAll('button')).map((el) => text(el)).filter(Boolean);
    return {
      title: document.title,
      url: location.href,
      bodyText,
      bodyTextLength: bodyText.length,
      dialogCount: dialogs.length,
      dialogs,
      dialogDetails,
      fixedTexts,
      formControlCount: formControls.length,
      formControls,
      buttons,
    };
  })())`);
  return {
    ...data,
    bodyText: undefined,
    bodyHash: hashText(data.bodyText || ""),
    bodyPreview: (data.bodyText || "").slice(0, 240),
  };
}

function clickButton(actionText) {
  return evalJson(`JSON.stringify((() => {
    const wanted = ${JSON.stringify(actionText)};
    const text = (el) => (el.innerText || el.textContent || '').trim();
    const matches = Array.from(document.querySelectorAll('button')).filter((el) => text(el) === wanted);
    const el = matches[0];
    if (!el) return { clicked: false, reason: 'button-not-found', wanted, matchCount: 0 };
    el.scrollIntoView({ block: 'center', inline: 'center' });
    el.click();
    return { clicked: true, wanted, matchCount: matches.length, clickedText: text(el) };
  })())`);
}

function controlText(control) {
  return [
    control.tag,
    control.type,
    control.name,
    control.label,
    control.aria,
    control.placeholder,
    control.nearby,
    ...(control.options || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function isReasonOnlyControl(control) {
  const value = controlText(control);
  return /理由|依据|工单|备注|处置|影响面|回滚预案|审计|reason|remark|note/.test(value);
}

function isBusinessTextControl(control) {
  if (!["input", "textarea"].includes(control.tag)) return false;
  const type = control.type.toLowerCase();
  if (["hidden", "search", "checkbox", "radio", "button", "submit"].includes(type)) return false;
  return !isReasonOnlyControl(control);
}

function isChoiceControl(control) {
  const type = control.type.toLowerCase();
  return ["select"].includes(control.tag) || ["radio", "checkbox"].includes(type) || ["combobox", "listbox", "radio", "checkbox"].includes(control.tag);
}

function modalBusinessAssessment(route, actionText, after) {
  let dialogDetails = after.dialogDetails || [];
  if (!dialogDetails.length) {
    dialogDetails = (after.fixedTexts || [])
      .filter((text) => /确认|取消|执行摘要|删除|下架|保存|发布|放行|拒绝|冻结/.test(text) && text.length > 20)
      .map((text) => ({
        text,
        controls: [],
        buttons: [
          ...(/取消/.test(text) ? [{ text: "取消", disabled: false }] : []),
          ...(/确认|保存|发布|放行|拒绝|冻结|删除|下架/.test(text) ? [{ text: "确认", disabled: false }] : []),
        ],
      }));
  }
  const dialogText = dialogDetails.map((dialog) => dialog.text || "").join("\n");
  const dialogControls = dialogDetails.flatMap((dialog) => dialog.controls || []);
  const businessTextControls = dialogControls.filter(isBusinessTextControl);
  const choiceControls = dialogControls.filter(isChoiceControl);
  const controlCorpus = dialogControls.map(controlText).join("\n");
  const corpus = `${actionText}\n${route}\n${dialogText}\n${controlCorpus}`.toLowerCase();
  const routeLower = route.toLowerCase();
  const reasons = [];
  const requirements = [];

  const pass = (requirement, detail) => {
    requirements.push({ requirement, ok: true, detail });
  };
  const fail = (requirement, detail) => {
    requirements.push({ requirement, ok: false, detail });
    reasons.push(detail);
  };

  if (!dialogDetails.length) {
    const feedbackText = [...(after.fixedTexts || []), after.bodyPreview || ""].join("\n");
    if (/先勾选|请选择|选中|至少选择|先选择/.test(feedbackText)) {
      pass("selection precondition feedback", "action explains that rows must be selected before opening the operation modal");
      return { level: "ok", requirements, reasons, dialogControlCount: 0, businessTextControlCount: 0, choiceControlCount: 0 };
    }
    if (routeLower.includes("/content/support") && /保存 FAQ|保存 SLA|保存 owner|回复并转待用户|关闭工单|重开工单/.test(actionText)) {
      const pageControls = after.formControls || [];
      const pageBusinessTextControls = pageControls.filter(isBusinessTextControl);
      const pageChoiceControls = pageControls.filter(isChoiceControl);
      if (pageBusinessTextControls.length + pageChoiceControls.length >= 2) {
        pass("inline support business form", `${pageBusinessTextControls.length} text and ${pageChoiceControls.length} choice control(s) already visible on page`);
        return {
          level: "ok",
          requirements,
          reasons,
          dialogControlCount: 0,
          businessTextControlCount: pageBusinessTextControls.length,
          choiceControlCount: pageChoiceControls.length,
        };
      }
    }
    fail("opens actionable modal", "button did not open a modal or drawer");
    return { level: "fail", requirements, reasons, dialogControlCount: 0, businessTextControlCount: 0, choiceControlCount: 0 };
  }

  pass("opens actionable modal", `${dialogDetails.length || after.dialogCount} modal/drawer layer(s) detected`);

  const inspectOnly = /清单|扫描|查看|预览/.test(actionText) && !/重扫|修复|发布|下发|删除|回滚|下架/.test(actionText);
  const needsRole = /改角色|新建运营账号|新建账号|创建账号/.test(actionText);
  const needsPermission = /改授权|改权限|授权|权限/.test(actionText);
  const needsLocalizedCopy =
    (routeLower.includes("/content/i18n") || /中英|i18n|翻译|词条|locale|localized/.test(`${actionText}\n${dialogText}`)) &&
    /编辑|新建|创建|补全|修复|草拟/.test(actionText);
  const needsCourse = !needsLocalizedCopy && (/课程|lesson|course|教程/.test(`${actionText}\n${dialogText}`) || routeLower.includes("/content/learn")) && /新建|创建|编辑|草拟/.test(actionText);
  const needsCampaign = (routeLower.includes("/content/notifications") || /campaign|通知|公告/.test(actionText)) && /新建|创建|编辑/.test(actionText);
  const needsNovaChannel = routeLower.includes("/content/nova") && /编辑/.test(actionText);
  const needsContentDraft = /草拟新版|编辑草稿|发新版/.test(actionText) && /disclosure|trust|copy-ab|披露|信任|文案/.test(corpus);
  const confirmationOnly =
    /发布|下架|删除|回滚|立即下发|调度下发|修复|重扫|扫描|确认|拒绝|批准|驳回/.test(actionText) &&
    !/编辑|新建|创建|草拟/.test(actionText);

  if (inspectOnly) {
    if (dialogText.length > 80) pass("inspection content", "read-only inspection/list modal contains business detail");
    else fail("inspection content", "inspection action opened an empty or non-informative modal");
    return {
      level: reasons.length ? "fail" : "ok",
      requirements,
      reasons,
      dialogControlCount: dialogControls.length,
      businessTextControlCount: businessTextControls.length,
      choiceControlCount: choiceControls.length,
    };
  }

  if (needsRole) {
    const hasRoleChoice = choiceControls.some((control) => /角色|role|权限|operator|admin|viewer|analyst|support|finance|risk/.test(controlText(control)));
    if (hasRoleChoice) pass("role-change component", "role-related select/radio/listbox control found");
    else fail("role-change component", "role action lacks a role selector or equivalent permission control");
  }

  if (needsPermission) {
    const hasPermissionChoice = choiceControls.some((control) => /权限|授权|permission|scope|matrix|module|read|write|approve|m\/c\/r/.test(controlText(control)));
    if (hasPermissionChoice) pass("permission matrix component", "permission-related select/radio/listbox control found");
    else fail("permission matrix component", "permission action lacks a permission matrix or structured authorization control");
  }

  if (needsLocalizedCopy) {
    const localizedControls = dialogControls.filter((control) => /中文|英文|中英|zh|en|locale|文案|词条|翻译|copy/.test(controlText(control)) && isBusinessTextControl(control));
    if (localizedControls.length >= 2 || (localizedControls.length >= 1 && businessTextControls.length >= 2)) {
      pass("localized copy fields", `${localizedControls.length} localized control(s), ${businessTextControls.length} business text control(s)`);
    } else {
      fail("localized copy fields", "localized/i18n action lacks editable zh/en copy fields");
    }
  }

  if (needsCourse) {
    const hasCourseFields = dialogControls.filter((control) => /课程|标题|内容|章节|时长|分类|语言|lesson|course|title|content|duration|category/.test(controlText(control)) && (isBusinessTextControl(control) || isChoiceControl(control)));
    if (hasCourseFields.length >= 2) pass("course authoring fields", `${hasCourseFields.length} course field(s) found`);
    else fail("course authoring fields", "course create/edit action lacks title/content/category/duration controls");
  }

  if (needsCampaign) {
    const hasCampaignFields = dialogControls.filter((control) => /campaign|标题|正文|内容|人群|目标|预算|优先级|调度|时间|通知|公告|推送|title|body|target|audience|budget|priority|schedule/.test(controlText(control)) && (isBusinessTextControl(control) || isChoiceControl(control)));
    if (hasCampaignFields.length >= 3) pass("campaign composition fields", `${hasCampaignFields.length} campaign field(s) found`);
    else if (/新建|创建|编辑/.test(actionText)) fail("campaign composition fields", "campaign create/edit action lacks enough title/body/audience/schedule controls");
  }

  if (needsNovaChannel) {
    const hasNovaFields = dialogControls.filter((control) => /通道|tick|节奏|cooldown|歇|ctr|channel/.test(controlText(control)) && isBusinessTextControl(control));
    if (hasNovaFields.length >= 3) pass("nova channel fields", `${hasNovaFields.length} Nova channel field(s) found`);
    else fail("nova channel fields", "Nova edit action lacks channel/tick/cooldown/CTR controls");
  }

  if (needsContentDraft && !confirmationOnly) {
    const contentDraftFields = dialogControls.filter((control) => /版本|标题|正文|内容|法域|语言|中文|英文|文案|披露|信任|copy|version|title|body|content|jurisdiction|locale/.test(controlText(control)) && (isBusinessTextControl(control) || isChoiceControl(control)));
    if (contentDraftFields.length >= 2) pass("content draft fields", `${contentDraftFields.length} content/version field(s) found`);
    else fail("content draft fields", "draft/edit action lacks content/version editing controls");
  }

  if (confirmationOnly) {
    const reasonControls = dialogControls.filter(isReasonOnlyControl);
    const confirmButtons = dialogDetails.flatMap((dialog) => dialog.buttons || []).filter((button) => /确认|执行|发布|下发|删除|回滚|下架|开始/.test(button.text));
    const needsReason = /删除|下架|冻结|解冻|拒绝|驳回|放行|回滚|调账|调整|发布|下发|熔断|切换|确认/.test(actionText) || /理由|审计|工单|依据/.test(dialogText);
    if (!confirmButtons.length) {
      fail("confirmation path", "confirmation action lacks a confirm control");
    } else if (needsReason && !reasonControls.length && !businessTextControls.length) {
      fail("confirmation path", "confirmation action requires an operation reason but exposes no reason input");
    } else if (reasonControls.length || businessTextControls.length || confirmButtons.length) {
      pass("confirmation path", `${reasonControls.length} reason control(s), ${confirmButtons.length} confirm button(s)`);
    } else {
      fail("confirmation path", "confirmation action lacks reason input or confirm control");
    }
  }

  if (!requirements.length) {
    if (businessTextControls.length || choiceControls.length) pass("generic business controls", `${businessTextControls.length} text and ${choiceControls.length} choice control(s) found`);
    else fail("generic business controls", "modal has no business input beyond display text");
  }

  return {
    level: reasons.length ? "fail" : "ok",
    requirements,
    reasons,
    dialogControlCount: dialogControls.length,
    businessTextControlCount: businessTextControls.length,
    choiceControlCount: choiceControls.length,
  };
}

function uniqueBusinessActions(routeRow) {
  const seen = new Set();
  const buttons = routeRow.evidence?.runtime?.buttons || [];
  const actions = [];
  const route = routeRow.route || "";
  for (const button of buttons) {
    const text = (button.text || button.aria || "").trim();
    if (button.tag !== "button" || !text || button.disabled) continue;
    if (/^已/.test(text)) continue;
    if (route === "/users/search" && /^(全部|冻结|高风险|KYC 待确认|正常|未验证|复审中)$/.test(text)) continue;
    if (route === "/finance/ledger" && /^(全部|充值|提现|收益|佣金|兑换|退款|bonus|人工调整)$/.test(text)) continue;
    if (route === "/finance/recon" && /^(待确认|已确认|异常|对平)$/.test(text)) continue;
    if (route === "/risk/withdrawal-rules" && /^(全部|延迟|冻结|转人工)$/.test(text)) continue;
    if (route === "/analytics/export" && /^(全部|待确认|生成中|可下载)$/.test(text)) continue;
    if (route === "/analytics/funnel-cohort" && /^(vs W18\(P2 期\)|vs W20|关闭对比)$/.test(text)) continue;
    if (route === "/analytics/kpi" && /^#\d+(\n|\s)/.test(text)) continue;
    if (route === "/content/support" && /^(已确认工单信息|支付台账已核对|请补充截图|问题已处理并关闭)/.test(text)) continue;
    if (!ACTION_RE.test(text)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    actions.push(text);
    if (actions.length >= maxActionsPerRoute) break;
  }
  return actions;
}

function classify(route, actionText, before, after, clickResult) {
  const flags = {
    urlChanged: before.url !== after.url,
    bodyChanged: before.bodyHash !== after.bodyHash,
    dialogChanged: before.dialogCount !== after.dialogCount,
    fixedChanged: JSON.stringify(before.fixedTexts) !== JSON.stringify(after.fixedTexts),
    formControlsChanged: before.formControlCount !== after.formControlCount,
  };
  const observable = Object.values(flags).some(Boolean);
  let businessAssessment = modalBusinessAssessment(route, actionText, after);
  if (flags.urlChanged && businessAssessment.level === "fail") {
    businessAssessment = {
      level: "ok",
      requirements: [{ requirement: "navigation path", ok: true, detail: `action navigated to ${after.url}` }],
      reasons: [],
      dialogControlCount: 0,
      businessTextControlCount: 0,
      choiceControlCount: 0,
    };
  }
  if (/导出|export/i.test(actionText) && flags.fixedChanged && businessAssessment.level === "fail") {
    businessAssessment = {
      level: "ok",
      requirements: [{ requirement: "export feedback", ok: true, detail: "export action produced visible toast/status feedback" }],
      reasons: [],
      dialogControlCount: 0,
      businessTextControlCount: 0,
      choiceControlCount: 0,
    };
  }
  let classification = observable ? "observable-change" : "no-observable-change";
  if (businessAssessment.level === "fail") classification = "business-incomplete-modal";
  if (!clickResult.clicked) classification = "click-target-missing";
  return { classification, flags, businessAssessment };
}

fs.mkdirSync(SHARDS, { recursive: true });
fs.mkdirSync(SCREENSHOTS, { recursive: true });

const routeEvidenceFile = path.join(SHARDS, `${shardId.toLowerCase()}-runtime.ndjson`);
if (!fs.existsSync(routeEvidenceFile)) {
  throw new Error(`Missing route evidence file: ${path.relative(ROOT, routeEvidenceFile)}`);
}

const routeRows = fs
  .readFileSync(routeEvidenceFile, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .filter((row) => row.status === "captured");

const outFile = path.join(SHARDS, `${shardId.toLowerCase()}-action-sample.ndjson`);
fs.writeFileSync(outFile, "", "utf8");

for (const routeRow of routeRows) {
  const actions = uniqueBusinessActions(routeRow);
  for (const actionText of actions) {
    const route = routeRow.route;
    const url = `${BASE_URL}${route}`;
    const actionSlug = safeName(actionText);
    const routeSlug = safeName(route);
    const entry = {
      shardId,
      source: "A-runtime-action-sample",
      side: "admin",
      route,
      url,
      actionText,
      startedAt: new Date().toISOString(),
      status: "pending",
    };
    try {
      run(["open", url], { timeout: 45000 });
      run(["wait", "--load", "networkidle"], { timeout: 45000 });
      const before = probe();
      if (before.url === "about:blank" || before.bodyTextLength === 0) {
        throw new Error(`route did not load before action sampling: ${url}`);
      }
      const clickResult = clickButton(actionText);
      run(["wait", "700"], { timeout: 5000 });
      const after = probe();
      const screenshotPath = path.join(SCREENSHOTS, `${shardId.toLowerCase()}-${routeSlug}-${actionSlug}-after.png`);
      run(["screenshot", screenshotPath], { timeout: 45000 });
      entry.status = "sampled";
      entry.clickResult = clickResult;
      entry.result = classify(route, actionText, before, after, clickResult);
      entry.evidence = {
        screenshot: path.relative(ROOT, screenshotPath).replace(/\\/g, "/"),
        before: {
          url: before.url,
          bodyHash: before.bodyHash,
          bodyTextLength: before.bodyTextLength,
          dialogCount: before.dialogCount,
          fixedTexts: before.fixedTexts,
          formControlCount: before.formControlCount,
        },
        after: {
          url: after.url,
          bodyHash: after.bodyHash,
          bodyTextLength: after.bodyTextLength,
          dialogCount: after.dialogCount,
          dialogs: after.dialogs,
          dialogDetails: after.dialogDetails,
          fixedTexts: after.fixedTexts,
          formControlCount: after.formControlCount,
          formControls: after.formControls,
          bodyPreview: after.bodyPreview,
        },
      };
    } catch (error) {
      entry.status = "error";
      entry.error = error.message;
    }
    entry.finishedAt = new Date().toISOString();
    lineJson(outFile, entry);
  }
}

try {
  run(["close"], { timeout: 15000 });
} catch {}

const rows = fs
  .readFileSync(outFile, "utf8")
  .trim()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const summary = {
  shardId,
  routes: routeRows.length,
  samples: rows.length,
  sampled: rows.filter((row) => row.status === "sampled").length,
  errors: rows.filter((row) => row.status === "error").length,
  noObservableChange: rows.filter((row) => row.result?.classification === "no-observable-change").length,
  businessIncompleteModal: rows.filter((row) => row.result?.classification === "business-incomplete-modal").length,
  outFile: path.relative(ROOT, outFile).replace(/\\/g, "/"),
};
console.log(JSON.stringify(summary, null, 2));
