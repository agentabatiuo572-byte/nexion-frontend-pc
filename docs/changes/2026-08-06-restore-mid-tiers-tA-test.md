本页判定目标=G4 阶梯档位定价卡:三档渲染/三弹窗契约/fail-closed/单档降级(来源:任务 AC A1–A5)

# 独立黑盒验收报告 · A 组(G4 /finance-products/genesis)

- 验收人:独立 tester agent(黑盒,不改仓)· 2026-08-06
- 被测:worktree `pkg-restore-midtiers` dev @ http://localhost:3022,页面 `/finance-products/genesis`
- 方法:Playwright(chromium headless)页面级 `page.route` 拦截。session 走 GET `/api/admin/auth/session` 伪造 superadmin(空 authorities,G 域 `allowed()` 走 role 旁路);G4 数据走 GET `/api/admin/market/nex/genesis` 注入契约合法 fixture(过 `assertG4OverviewContract` 全部严格键);设 `nexion_admin_token` cookie 使未拦截接口走真实 503(后端 :8110 不在本机,预期环境态)。四种 tiers 变体逐次整页重载:3 档 / 缺席 / 坏形(priceUSDT:"abc")/ 单档。
- 证据:截图 `scratchpad/t-all/tA-*.png`(a1 卡片、a2 编辑弹窗、a3 增开+删档弹窗、a4 缺席+坏形、a5 单档),机读结果 `tA-results.json`。

## 逐 AC 结论

| AC | 结论 | 验证方式 | 观察原文 |
|---|---|---|---|
| A1 3 档渲染 | **PASS** | 注入 wl[0,100)$7999 / t1[100,550)$9999 / t2[550,1000)$11999 后实测卡片 DOM | 「阶梯档位定价」卡在;tbody rows=3;末行含「末档」徽标(bdg=1);列头含 档位/起始(含)/截止(不含)/单价 USDT;卡头「+ 增开档位」=1;行内「编辑」=3、「删档」=3;档值 7,999/9,999/11,999 渲染 |
| A2 编辑弹窗 | **PASS** | 点首行「编辑」后实测弹窗 DOM + 理由长度门 | 弹窗标题含「编辑创世档位 · wl」;`input[type=number]`=2,标签「截止(累计售出上界)」「单价(USDT)」在;理由填 2 字 →「确认提交」disabled(提示「还需补充 N 字,确认按钮才会启用」);≥8 字 → enabled |
| A3 增开/删档弹窗 + 可取消 | **PASS** | 逐个打开增开、删档弹窗实测 DOM;三弹窗逐个点「取消」验关闭 | 「增开创世档位」弹窗数值字段=2;「删除创世档位 · t1」弹窗数值字段=0、无「目标新值」、仅理由 textarea=1;编辑/增开/删档三弹窗「取消」后 dialog 计数均归 0 |
| A4 缺席/坏形 fail-closed | **PASS** | 缺席与坏形两份 fixture 各自整页重载后**全页**扫「+ 增开档位/编辑/删档」按钮 | 两态均显「服务端尚未下发阶梯档位数据(后端未升级或数据坏形)· …本卡不提供增开/编辑/删除入口」;全页三类按钮 0/0/0;其余区块(「节点经济参数」「一二级市场」)照常渲染 |
| A5 单档降级 | **PASS** | 单档 fixture 整页重载后实测行内动作 | rows=1;「编辑」=1;「删档」=0;动作格渲染「—」占位 |

Console:三组页面加载 pageerror=0;非网络类 console error 仅 A4 坏形态出现 2 条 `[G4] tiers 契约坏形(边界与单价须为整数),整组 fail-closed`——这是 `lib/admin/g4-client.ts` L319 **应用自身故意打的诊断样本**(dev StrictMode 双跑 ×2),不是 React 错误;未拦截接口的 503 网络噪声计 94 条(预期环境态)。

## 可疑点(单列,不占 AC)

1. **被审文件在验收窗口内漂移**:`lib/admin/g4-client.ts` 的 `normalizeTiers` 在本次验收窗口内从「字段级校验」升级为「区间全量不变量(整数/价>0/从 0 连续/id 唯一/末档≥已售)+ console.error 留样」——初读(验收开始)无 L319 console.error,末读有;worktree 处于未提交修改态。**最终判定以末态代码的三连跑为准(全 PASS,且诊断日志证明 dev server 已供最新模块)**,但「审计期间冻结被审文件」纪律被打破,后续轮次请冻结。
2. **A4 坏形路径的 console.error 会误伤「console error=0」类机器门**:该诊断是有意设计(fail-closed 留样本),但任何用「console 零 error」作判据的走查/哨兵需要把 `[G4] tiers 契约坏形` 前缀白名单,否则坏数据环境下会假红。
3. (脚手架侧教训,非产品缺陷)首轮 fixture 把 `coverage.redlinePct` 写成 120 被 `assertG4OverviewContract` 整页拒掉(`G4_RESPONSE_INVALID:data.coverage.redlinePct`,上限 100)——反向证明读侧契约门真实在跑。
