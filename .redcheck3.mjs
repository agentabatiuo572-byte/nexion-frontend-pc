// 红测:逐个把本次改动回退成修前形态,确认对应验收门真的会红(有判别力)。
import fs from "node:fs";
const plan = [
  ["K4 输入源同名", "app/components/domain-views/k-tabs/k4-scoring.tsx", /\r?\n\s+aria-label=\{`\$\{dimension\.name\}输入源`\}/, ""],
  ["K1 调整按钮无名", "app/components/domain-views/k-tabs/k1-multiaccount.tsx", / aria-label=\{`调整\$\{p\.name\}`\}/g, ""],
  ["L4 周期无组名", "app/components/domain-views/l-tabs/l4-ops.tsx", /<TabGroup\r?\n[\s\S]*?<\/TabGroup>/, `{PERIODS.map(([period, label]) => (<button key={period} className="l-btn sm" aria-pressed={query.period === period} onClick={() => period === "custom" ? updateQuery({ period }) : updateQuery({ period, from: undefined, to: undefined })}>{label}</button>))}`],
  ["M2 搜索框无名", "app/components/domain-views/m-tabs/m2-tickets.tsx", / aria-label="搜索工单主题、单号、负责人、分类或用户编码"/, ""],
  ["L1 时间窗无组名", "app/components/domain-views/l-tabs/l1-kpi.tsx", /<TabGroup<L1Window>\r?\n[\s\S]*?<\/TabGroup>/, `{([["1d", "当日"], ["7d", "滚动 7d"], ["30d", "滚动 30d"], ["custom", "自定义"]] as const).map(([v, lb]) => (<button key={v} className={"chip" + (win === v ? " sel" : "")} onClick={() => { if (v === "custom") { setCustomOpen(true); return; } void reloadKpi(v); }}>{lb}</button>))}`],
];
const backups = plan.map(([label, p]) => ({ label, path: p, content: fs.readFileSync(p, "utf8") }));
fs.writeFileSync(".redcheck3.bak.json", JSON.stringify(backups));
for (const [label, p, pattern, replacement] of plan) {
  const s = fs.readFileSync(p, "utf8");
  const next = s.replace(pattern, replacement);
  if (next === s) { console.error("REDCHECK3: no-op for " + label); process.exit(2); }
  fs.writeFileSync(p, next);
}
console.log("REDCHECK3: reverted 5 fixes");
