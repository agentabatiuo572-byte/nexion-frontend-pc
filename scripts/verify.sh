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

# Windows npm 会命中 System32\bash.exe(WSL bash):非 login shell 可能找不到 node,
# 且 WSL curl 访问 Windows localhost 会返回 000。这里显式补齐工具路径。
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
NODE_BIN="${NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "  ✗ node not found in bash PATH"; exit 1
fi
CURL_BIN="${CURL_BIN:-curl}"
if [ -f /proc/version ] && grep -qi microsoft /proc/version && command -v curl.exe >/dev/null 2>&1; then
  CURL_BIN="curl.exe"
fi

check_http() {
  local code
  code=$("$CURL_BIN" -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE$1")
  if [ "$code" = "200" ]; then pass=$((pass+1)); else fail=$((fail+1)); fails="$fails\n  [http $code] $1"; fi
}
check_html() {
  if "$CURL_BIN" -s --max-time 10 "$BASE$1" | grep -qF "$2"; then pass=$((pass+1)); else fail=$((fail+1)); fails="$fails\n  [needle] $1 :: $2"; fi
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
done < <("$NODE_BIN" "$HERE/nav-routes.mjs" | tr -d '\r')
nav_count=$("$NODE_BIN" "$HERE/nav-routes.mjs" | grep -c '|')
if [ "$nav_count" -ne 66 ]; then
  echo "  ✗ nav-routes 仅提取 $nav_count 条(期望 66)— console-nav.ts 格式漂移致 verify 漏检"; fail=$((fail+1))
else
  echo "  nav-routes: $nav_count 条路由"
fi

echo "== [3/4] landing + flagship needles =="
check_http "/"
check_html "/" "运营总览"
check_html "/" "server-canonical"
# 指挥台首页各区(落地即态势)
check_html "/" "兑付覆盖率"
check_html "/" "高敏操作动态"
check_html "/" "风险雷达"
check_html "/" "转化漏斗"
check_html "/" "扩张期"
check_html "/" "KPI 验收墙"
# B1 双账本驾驶舱(旗舰)
check_html "/overview/dual-ledger" "双账本总览"
check_html "/overview/dual-ledger" "兑付覆盖率"
check_html "/overview/dual-ledger" "应付负债结构"
# D2 提现审核队列(设计稿 D 域视图 · D2 标签,2026-06-10 D 域 port:队列单源 WD-904xx 与 K3_HITS 同体系)
check_html "/finance/withdrawals" "提现审核队列"
check_html "/finance/withdrawals" "WD-90412"
check_html "/finance/withdrawals" "资金与财务"
check_html "/finance/withdrawals" "正常 5 态 + 异常 6 态"   # D2 状态机条(server-canonical)
check_html "/finance/withdrawals" "K5 hold"                # 复审未过禁放(PRD D2⑦ 联动)
# C 域六页(design_handoff_c_domain port 2026-06-11:C1-C6 全设计稿视图)+ 用户详情(L3 深链页 · 保留)
check_http "/users/search/U-88421"
check_html "/users/search" "用户与账户"
check_html "/users/search" "Marcus Lee"
check_html "/users/search" "账户操作"
check_html "/users/search" "设备持有者(L4+)"          # C1 stats(C1_STATS 单源)
check_html "/users/search" "只读检索 · 处置去对应页面"   # C1 f-ro(零写权不变量)
check_html "/users/actions" "账户处置"                   # C2 处置台(冻结台账权威)
check_html "/users/actions" "模拟登录控制台"             # C2 impersonate 三道锁
check_html "/users/actions" "信任 / 禁入名单"            # C2 账户级名单(与 K1 IP 白名单正交)
check_html "/users/assets" "发起调整"                    # C3 调整面(原因/凭证必填)
check_html "/users/assets" "挂起中的加钱申请"            # C3 挂起状态机(红线被拒转挂起)
check_html "/users/assets" "待确认队列"                  # C3 操作确认(C.adjust.* 真写)
check_html "/users/kyc" "触发条件与网络白名单"           # C4 阈值只读(归 K5/G2)
check_html "/users/kyc" "KYC 状态列表"                   # C4 唯一真相源台账
check_html "/users/security" "凭证与会话参数"            # C5 凭证参数(step-up V1 只读)
check_html "/users/security" "锁定状态与解除"            # C5 两档解锁(处置权归 C5)
check_html "/users/reg-risk" "验证码(OTP)"            # C6 OTP 参数面
check_html "/users/reg-risk" "防参数配两套打架"          # C6 与 K1 分工(422 拒收)
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
# A 域四页(design_handoff_a_domain port 2026-06-12:A1-A4 平台基座;A5 独立旗舰页)
check_html "/platform/rbac" "运营账号"                       # A1 账号台账
check_html "/platform/rbac" "全域权限矩阵"                   # A1 RBAC 矩阵
check_html "/platform/rbac" "登录与安全基线"                 # A1 三铁律(强制 2FA / 零写权 / ≥2 超管)
check_html "/platform/rbac" "默认拒绝"                       # A1 新账号零写权 server-canonical
check_html "/platform/audit" "高敏操作动态"                  # A2 14 件 pending
check_html "/platform/audit" "审计日志"                      # A2 只追加
check_html "/platform/audit" "应急快速轨"                    # A2 SOS SLA 倒计时
check_html "/platform/audit" "操作确认适用动作清单"              # A2 9 大类机制参数
check_html "/platform/config" "服务器时钟"                   # A3 server time 单源
check_html "/platform/config" "防重号策略"                   # A3 24h 去重窗口
check_html "/platform/config" "熔断闸状态存储"               # A3 只读跳 J1/J2
check_html "/platform/config" "feature flag"                 # A3 灰度台
check_html "/platform/events" "事件目录"                     # A4 6 family
check_html "/platform/events" "通用字段"                     # A4 字段固定
check_html "/platform/events" "八项 KPI"                     # A4 KPI 算式
check_html "/platform/events" "domain 扩展批次看板"          # A4 V4 内容批进行中
# I 域五页(design_handoff_i_domain port 2026-06-11:I1-I7 七子模块 / 5 页覆盖)
check_html "/content/copy-ab" "文案池"                       # I1 文案池
check_html "/content/copy-ab" "实验框架默认参数"             # I1 框架参数(普通确认带原因)
check_html "/content/copy-ab" "A/B 实验面板"                 # I1 实验台
check_html "/content/nova" "10 可调通道节奏表"               # I2 cadence
check_html "/content/nova" "这套开关不在熔断矩阵里"          # I2 kill 不入 J1/J2
check_html "/content/nova" "推送模板池"                      # I2 模板
check_html "/content/notifications" "优先级容量闸"           # I3 4 档 CAP
check_html "/content/notifications" "永不淘汰"               # I3 critical 锁定 ∞
check_html "/content/notifications" "合规通道特例"           # I3 critical 升合规 / J 域共用
check_html "/content/trust" "信任中心"                       # I4 6 版块
check_html "/content/trust" "披露矩阵"                       # I5 4 法域
check_html "/content/trust" "重确认覆盖监控"                 # I5 re-ack
check_html "/content/trust" "受限动作范围"                   # I5 gated (withdraw 已实装 / staking·nexv2 待接线)
check_html "/content/i18n" "命名空间矩阵"                    # I6 词条底座
check_html "/content/i18n" "完整性扫描"                      # I6 镜像 gate
check_html "/content/i18n" "教程中心"                        # I7 课程
check_html "/content/i18n" "涨奖励过 B1 红线"                # I7 唯一 amplifies(B1 红线核验,SSR 卡头副标)
check_html "/content/support" "Help/FAQ 内容管理"             # I8 Help 内容池
check_html "/content/support" "Ticket 分类与 SLA"             # I8 分类 SLA 管理
check_html "/content/support" "工单详情与处理"                # I8 工单回复/关闭真动作面
check_html "/content/support" "回复并转待用户"                # I8 业务动作控件在位
# A5 平台参数寄存器(平台运营面字段级控制索引 · 88 平台参数回源真值)
check_html "/platform/params-registry" "平台参数寄存器"
check_html "/platform/params-registry" "回源真值"
check_html "/platform/params-registry" "操作确认"
# D5 提现参数配置(设计稿 D 域视图 · D5 标签:owns 三参数 + H1 派发只读)
check_html "/finance/params" "提现参数"
check_html "/finance/params" "节奏派发 · 只读"             # H1 派发三项只读区(防双源)
check_html "/finance/params" "本页可调(操作确认)"        # D5 owns 三参数区
check_html "/finance/params" "红线核验"                    # 放松方向 B1 覆盖率核验说明

echo "== [4/4] 体验回归(运营者 / PM 视角 · 自动可检信号) =="
# 镜头 B 初次运营者:信息气味 / 状态信号 / 空态引导不退化
check_html "/" "模块"                                  # 域卡信息气味(域·N 模块)
check_html "/finance/recon" "充值对账"                  # D1 设计稿视图:充值对账标题在 SSR 渲染
check_html "/finance/recon" "资金与财务"                # D 域视图页头(子页统一布局信号)
check_html "/overview/dual-ledger" "健康"               # B1 覆盖率状态信号(运营者一眼可读;m7 基准 118.1%≥健康线110 → zoneLabel「健康」)
check_html "/finance/withdrawals" "review"              # D2 设计稿视图:提现状态在 SSR 表渲染
check_html "/finance/withdrawals" "WD-90412"
# 镜头 C 顶级 PM:决策颗粒度 / 全局态势 / 红线 / 审计可信不退化
check_html "/overview/dual-ledger" "净敞口"             # 颗粒度:储备−负债敞口
check_html "/overview/dual-ledger" "红线"               # 兑付红线(放大流出防线)
check_html "/overview/dual-ledger" "环比"               # 趋势/基线对比
check_html "/" "server-canonical"                      # 全局态势/可信信号常驻
check_html "/finance/withdrawals" "提现审核队列"        # 决策颗粒度:提现确认队列在位
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
check_html "/finance-products/staking" "金融产品"       # G 域视图:域名页头在位
check_html "/risk/multi-account" "三层去重命中列表"      # K1 设计稿 port:去重列表 + 拦截阈值在位
check_html "/risk/abuse" "闭环怎么判"                   # K2 设计稿 port:闭环分级判定卡在位
check_html "/risk/withdrawal-rules" "四道关"             # K3 设计稿 port:四维规则卡在位
check_html "/risk/scoring" "评分权重"                   # K4 设计稿 port:权重滑杆卡在位
check_html "/risk/kyc-review" "复审触发队列"             # K5 设计稿 port:SLA 队列在位
check_html "/finance/recon" "支付商报表 vs 平台入账"     # D1 设计稿 port:逐渠道对账面在位
check_html "/finance/recon" "拒付处置"                  # D1 chargeback 三连原子处置区在位
check_html "/finance/pool" "真实储备明细"                # D3 设计稿 port:储备底账(唯一源)在位
check_html "/finance/pool" "到期负债预测"                # D3 三类叠加预测在位
check_html "/finance/ledger" "滚动余额"                  # D4 设计稿 port:单用户 Running Balance 在位
check_html "/finance/ledger" "账实不符告警"              # D4 断点告警区在位
check_html "/finance-products/staking" "Position 状态机与监控"  # G1 设计稿 port:双池 4 档 + position 监控在位
check_html "/finance-products/staking" "保序校验"               # G1 三道硬门(B1 红线 + 跨档保序)在位
check_html "/finance-products/exchange" "三道额度线"            # G2 设计稿 port:caps 配置面在位
check_html "/finance-products/exchange" "拦截命中与队列"        # G2 三类拦截 + 次日队列在位
check_html "/finance-products/market" "行情走势"                # G3 设计稿 port:kline + 引擎参数在位
check_html "/finance-products/genesis" "分红派发监控"           # G4 设计稿 port:双口径派发卡在位
check_html "/finance-products/genesis" "节点持有台账"           # G4 ownership 台账在位
check_html "/finance-products/premium" "订阅状态机与监控"       # G5 segmented premium 段在位
check_html "/finance-products/nex-v2" "NEX v2 Founders Vault 配置"  # G6 段(l2Id 预选)在位
check_html "/finance-products/repurchase" "复投激励配置"        # G7 段(l2Id 预选)在位
echo "  注:运营者/PM/交互设计师 的定性维度由审计 panel(docs/REVIEW-RUBRIC.md 镜头 B/C/D)覆盖,此处仅守信号退化。"

echo "== [+] CGM 字段级覆盖 gate(CGM_BATCH=${CGM_BATCH:-B9}) =="
# 默认 B9 = 全运营面 0 gap 常驻 tripwire(全 185 行须 built/waived)。
# 暂存未完成新批次时临时降批:CGM_BATCH=B2 bash scripts/verify.sh
if (cd "$ROOT" && CGM_BATCH="${CGM_BATCH:-B9}" "$NODE_BIN" scripts/cgm-coverage.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [cgm-coverage] batch ${CGM_BATCH:-B9} 有未覆盖行(跑 CGM_BATCH=${CGM_BATCH:-B9} node scripts/cgm-coverage.mjs 看明细)"
fi

echo "== [+] 交互完整性自查 gate(死控件/页头错配/详情链全局/persist水合/版本漂移/凭据反模式)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-interaction-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [interaction-audit] 有 HIGH 残留(跑 node scripts/admin-interaction-audit.mjs 看明细)"
fi

echo "== [+] 动作完整性 gate(防新增死控件 + built 不退化 + 欠账量化;OPS_BATCH 收紧批次)=="
# 默认不设 OPS_BATCH = 只锁死回归 + 计欠账(pending 不爆红,允许增量补齐);逐批收紧:OPS_BATCH=P0 bash scripts/verify.sh
if (cd "$ROOT" && OPS_BATCH="${OPS_BATCH:-}" "$NODE_BIN" scripts/ops-actions-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [ops-actions] 有违例(新增死控件/built退化/批次未达;跑 node scripts/ops-actions-audit.mjs 看明细)"
fi

echo "== [+] 旧确认机制残留 gate =="
if (cd "$ROOT" && "$NODE_BIN" scripts/no-double-sign-terms.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [no-double-sign-terms] 旧确认机制词面或旧符号残留"
fi

echo "== [+] 业务弹窗契约 gate(角色/权限/内容/设备必须有业务控件)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-modal-contract-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [admin-modal-contract] 业务弹窗控件退化(reason-only/free-text-only/no-diff)"
fi

echo "== [+] 列表能力 gate(分页原语 + finance RT-014 接线 + 豁免注记)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-list-capability-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [admin-list-capability] 分页原语/finance 接线/豁免注记退化"
fi

echo "== [+] 全域列表能力 runtime gate(66 路由表格分页/明确小表例外)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-list-capability-global-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [admin-list-capability-global] runtime 表格分页/明确小表例外退化"
fi

echo "== [+] 支持后台 gate(FM-018 /content/support + ticket 字段镜像)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-support-surface-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [admin-support-surface] /content/support 路由/业务控件/字段镜像退化"
fi

echo "== [+] UniApp 全路由迁移 gate(Next 映射/pages/runtime/action sample)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/uniapp-port-coverage-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [uniapp-port-coverage] Next→UniApp 路由映射/runtime/action sample 有缺口"
fi

echo "== [+] UniApp persona walkthrough gate(提现/兑换回购/team finance 导航)=="
run_uniapp_persona_walkthrough() {
  if [ -f /proc/version ] && grep -qi microsoft /proc/version && command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
    local win_root uni_base ps_script
    win_root="$(wslpath -w "$ROOT")"
    uni_base="${UNI_BASE_URL:-http://localhost:5173}"
    ps_script="Set-Location -LiteralPath '$win_root'; \$env:UNI_BASE_URL='$uni_base'; node scripts\\uniapp-persona-walkthrough-proof.mjs"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ps_script"
  else
    (cd "$ROOT" && "$NODE_BIN" scripts/uniapp-persona-walkthrough-proof.mjs)
  fi
}
if run_uniapp_persona_walkthrough; then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [uniapp-persona-walkthrough] FT-013/014/015 persona 业务闭环失败"
fi

echo "== [+] Feature-mapping walkthrough gate(FM-004/005/008/013/016)=="
run_feature_mapping_walkthrough() {
  if [ -f /proc/version ] && grep -qi microsoft /proc/version && command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
    local win_root uni_base admin_base ps_script
    win_root="$(wslpath -w "$ROOT")"
    uni_base="${UNI_BASE_URL:-http://localhost:5173}"
    admin_base="${ADMIN_BASE_URL:-${ADMIN_BASE:-http://localhost:3002}}"
    ps_script="Set-Location -LiteralPath '$win_root'; \$env:UNI_BASE_URL='$uni_base'; \$env:ADMIN_BASE_URL='$admin_base'; node scripts\\feature-mapping-walkthrough-proof.mjs"
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ps_script"
  else
    (cd "$ROOT" && "$NODE_BIN" scripts/feature-mapping-walkthrough-proof.mjs)
  fi
}
if run_feature_mapping_walkthrough; then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [feature-mapping-walkthrough] FM-004/005/008/013/016 业务闭环失败"
fi

echo "== [+] SKU 字段镜像 gate(后台 OpsSku ⊇ 前端 Product;防前端加字段后台漏)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/sku-field-mirror.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [sku-field-mirror] 后台 OpsSku 未覆盖前端 Product 字段(跑 node scripts/sku-field-mirror.mjs 看明细)"
fi

echo "== [+] Canon 数字口径 gate(staking/genesis/device/product 三端同源)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/canon-sentinel.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [canon-sentinel] 核心业务数字跨端漂移(跑 node scripts/canon-sentinel.mjs 看明细)"
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
