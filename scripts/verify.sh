#!/usr/bin/env bash
# Nexion 运营后台 — 回测 tripwire。
# tsc + nav 全路由 HTTP200 + 脚手架 needle(规格就绪) + 旗舰 needle。
# 路由清单由 nav-routes.mjs 从 console-nav.ts 自动生成(单一真源)。
# 用法:bash scripts/verify.sh [all]   dev server 须在 :3002。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BASE="${ADMIN_BASE:-http://localhost:3002}"
pass=0; fail=0; fails=""

check_http() {
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE$1")
  if [ "$code" = "200" ]; then pass=$((pass+1)); else fail=$((fail+1)); fails="$fails\n  [http $code] $1"; fi
}
check_html() {
  if curl -s --max-time 10 "$BASE$1" | grep -qF "$2"; then pass=$((pass+1)); else fail=$((fail+1)); fails="$fails\n  [needle] $1 :: $2"; fi
}

echo "== [1/4] tsc =="
# 注:不能用 `tsc | tail`,管道退出码是 tail 的(0)会吞掉 tsc 失败。捕获输出 + 退出码。
tsc_out=$(cd "$ROOT" && npx --no-install tsc --noEmit 2>&1)
tsc_code=$?
if [ "$tsc_code" -eq 0 ]; then
  echo "  tsc 0 errors"
else
  echo "  TSC FAILED:"; echo "$tsc_out" | tail -12; exit 1
fi

echo "== [2/4] nav routes (HTTP 200 + scaffold needle) =="
while IFS='|' read -r path id status; do
  [ -z "$path" ] && continue
  check_http "$path"
  if [ "$status" = "scaffold" ]; then check_html "$path" "规格就绪"; fi
done < <(node "$HERE/nav-routes.mjs" | tr -d '\r')
nav_count=$(node "$HERE/nav-routes.mjs" | grep -c '|')
if [ "$nav_count" -ne 70 ]; then
  echo "  ✗ nav-routes 仅提取 $nav_count 条(期望 70)— console-nav.ts 格式漂移致 verify 漏检"; fail=$((fail+1))
else
  echo "  nav-routes: $nav_count 条路由"
fi

echo "== [3/4] landing + flagship needles =="
check_http "/"
check_html "/" "运营总览"
check_html "/" "server-canonical"
# 指挥台首页各区(落地即态势)
check_html "/" "兑付覆盖率"
check_html "/" "待我处理"
check_html "/" "风险雷达"
check_html "/" "转化漏斗"
check_html "/" "扩张期"
check_html "/" "KPI 验收墙"
# B1 双账本驾驶舱(旗舰)
check_html "/overview/dual-ledger" "双账本总览"
check_html "/overview/dual-ledger" "兑付覆盖率"
check_html "/overview/dual-ledger" "应付负债结构"
# D2 提现审核队列(设计稿 D 域视图 · D2 标签)
check_html "/finance/withdrawals" "提现审核队列"
check_html "/finance/withdrawals" "WD-9F3A21"
check_html "/finance/withdrawals" "资金与财务"
# C1 用户检索(设计稿 C 域视图 · C1 标签)+ 用户详情(L3 深链页 · 保留)
check_http "/users/search/U-88421"
check_html "/users/search" "用户与账户"
check_html "/users/search" "Marcus Lee"
check_html "/users/search" "账户操作"
check_html "/users/search/U-88421" "风险画像"
check_html "/users/search/U-88421" "账户操作"
check_html "/users/search/U-88421" "审计时间线"
check_html "/users/search/U-88421" "投入卡"                  # C1·deepening deposit 投入卡(360 HUB 字段级)
check_html "/users/search/U-88421" "逐笔充值流水"            # 投入卡逐笔 topup 表(D4 账本切片)
check_html "/users/search/U-88421" "提现卡"                  # 360 HUB 提现卡
check_html "/users/search/U-88421" "设备卡"                  # 360 HUB 设备 CRUD
check_html "/users/search/U-88421" "收益台账"                # 360 HUB 收益台账 CRUD
check_html "/users/search/U-88421" "邀请卡"                  # 360 HUB 邀请卡(补 F 缺口)
check_html "/users/search/U-88421" "等级卡"                  # 360 HUB V 级卡
check_html "/users/search/U-88421" "财务持仓卡"              # 360 HUB staking/Genesis/兑换
check_html "/users/search/U-88421" "互动卡"                  # 360 HUB 任务/签到/抽奖/里程碑
check_html "/users/search/U-88421" "账户·安全·合规卡"        # 360 HUB auth/KYC/2FA/会话/档案/领导池
check_html "/users/search/U-88421" "订单·商城·收据·试用卡"   # 360 HUB orders/receipts/trial/cart
check_html "/users/search/U-88421" "通知·偏好卡"             # 360 HUB notif log/prefs/sound/haptics
# A5 平台参数寄存器(平台运营面字段级控制索引 · 88 平台参数回源真值)
check_html "/platform/params-registry" "平台参数寄存器"
check_html "/platform/params-registry" "回源真值"
check_html "/platform/params-registry" "MC 双签"
# D5 提现参数配置(设计稿 D 域视图 · D5 标签)
check_html "/finance/params" "提现参数"
check_html "/finance/params" "提现冷却"
check_html "/finance/params" "放大流出"

echo "== [4/4] 体验回归(运营者 / PM 视角 · 自动可检信号) =="
# 镜头 B 初次运营者:信息气味 / 状态信号 / 空态引导不退化
check_html "/" "模块"                                  # 域卡信息气味(域·N 模块)
check_html "/finance/recon" "充值对账"                  # D1 设计稿视图:充值对账标题在 SSR 渲染
check_html "/finance/recon" "资金与财务"                # D 域视图页头(子页统一布局信号)
check_html "/overview/dual-ledger" "警戒"               # B1 覆盖率状态信号(运营者一眼可读)
check_html "/finance/withdrawals" "review"              # D2 设计稿视图:提现状态在 SSR 表渲染
check_html "/finance/withdrawals" "WD-9F3A21"
# 镜头 C 顶级 PM:决策颗粒度 / 全局态势 / 红线 / 审计可信不退化
check_html "/overview/dual-ledger" "净敞口"             # 颗粒度:储备−负债敞口
check_html "/overview/dual-ledger" "红线"               # 兑付红线(放大流出防线)
check_html "/overview/dual-ledger" "环比"               # 趋势/基线对比
check_html "/" "server-canonical"                      # 全局态势/可信信号常驻
check_html "/finance/withdrawals" "提现审核队列"        # 决策颗粒度:提现复核队列在位
check_html "/finance/withdrawals" "风险"                # 风险维度在位
# 镜头 D 交互设计师:版面填充/洞察哨兵(防留白回潮 + 控件失数退化)
check_html "/" "最大流失"                               # 漏斗底部洞察带在位(flex 填充 + PM 价值)
check_html "/" "净敞口曲线"                             # B1 净敞口曲线卡在位(设计稿元素不被省略)
# 设计稿 restyle 保真哨兵(防风格回退到旧 shell / 黑话代号)
check_html "/platform/rbac" "搜索 userId"               # 顶栏全局搜索框(设计稿签名元素)在位
check_html "/overview/liquidity" "资金池水位"             # B 域 archetype 页正常渲染(模块口径副标在位)
# 设计稿内容视图铺满全域哨兵(防回退到旧 archetype 模板)
check_html "/network/royalty" "分销与团队"              # F 域视图:域整页骨架(标题 + Tab + 富内容)
check_html "/devices/pricing" "设备与商城"              # E 域视图:新增 SKU + 商品目录 Tab
check_html "/finance-products/staking" "金融产品"       # G 域视图:Staking 池配置 Tab
check_html "/risk/multi-account" "反多账户"             # K 域视图:风控簇内容
echo "  注:运营者/PM/交互设计师 的定性维度由审计 panel(docs/REVIEW-RUBRIC.md 镜头 B/C/D)覆盖,此处仅守信号退化。"

echo "== [+] CGM 字段级覆盖 gate(CGM_BATCH=${CGM_BATCH:-B9}) =="
# 默认 B9 = 全运营面 0 gap 常驻 tripwire(全 185 行须 built/waived)。
# 暂存未完成新批次时临时降批:CGM_BATCH=B2 bash scripts/verify.sh
if (cd "$ROOT" && CGM_BATCH="${CGM_BATCH:-B9}" node scripts/cgm-coverage.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [cgm-coverage] batch ${CGM_BATCH:-B9} 有未覆盖行(跑 CGM_BATCH=${CGM_BATCH:-B9} node scripts/cgm-coverage.mjs 看明细)"
fi

echo "== [+] 交互完整性自查 gate(死控件/页头错配/详情链全局/persist水合/版本漂移/凭据反模式)=="
if (cd "$ROOT" && node scripts/admin-interaction-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [interaction-audit] 有 HIGH 残留(跑 node scripts/admin-interaction-audit.mjs 看明细)"
fi

echo "== [+] 动作完整性 gate(防新增死控件 + built 不退化 + 欠账量化;OPS_BATCH 收紧批次)=="
# 默认不设 OPS_BATCH = 只锁死回归 + 计欠账(pending 不爆红,允许增量补齐);逐批收紧:OPS_BATCH=P0 bash scripts/verify.sh
if (cd "$ROOT" && OPS_BATCH="${OPS_BATCH:-}" node scripts/ops-actions-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [ops-actions] 有违例(新增死控件/built退化/批次未达;跑 node scripts/ops-actions-audit.mjs 看明细)"
fi

echo "== [+] SKU 字段镜像 gate(后台 OpsSku ⊇ 前端 Product;防前端加字段后台漏)=="
if (cd "$ROOT" && node scripts/sku-field-mirror.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [sku-field-mirror] 后台 OpsSku 未覆盖前端 Product 字段(跑 node scripts/sku-field-mirror.mjs 看明细)"
fi

echo "----------------------------------------"
if [ "$fail" -eq 0 ]; then
  echo "✓ verify PASS — $pass checks, 0 failed"
  exit 0
else
  echo "✗ verify FAIL — $pass passed, $fail failed"
  echo -e "$fails"
  exit 1
fi
