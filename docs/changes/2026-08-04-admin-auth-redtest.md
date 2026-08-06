# 2026-08-04 强制改密闸门 —— 红测留痕

对应改动:`fix(auth): 改密态不发全权凭证 + 高敏代理统一闸门 + 接线哨兵(存量 P1)`

## 缺陷原状

`app/api/admin/auth/login/route.ts` 只要拿到 accessToken + session 就下发 8 小时全权 cookie,**完全不看
`session.passwordChangeRequired`**。`lib/store/admin-auth.ts` 的 `isAuthenticated: !session.passwordChangeRequired`
只挡前端 UI 状态;`login-gate.tsx` 发现该标志为真时不调 signIn,但**那时 cookie 已经被浏览器种下**,与 JS 分支无关。
全部业务代理路由(finance / withdraw / emergency / platform …)只检查 cookie 存不存在就转发 Bearer token,零
`passwordChangeRequired` 感知。结论:强制改密在信任边界上是 0 道闸门。

## 修法(BFF 层能做到的两件事)

1. **签发端**:`passwordChangeRequired` 为真时不种全权 cookie(显式写空 + maxAge 0),只种受限 cookie
   `nexion_admin_pwd_change_token`,它只够走改密和登出。
2. **消费端**:23 条业务代理路由在读 token 之前统一过 `requirePasswordChangeCleared()`
   (`lib/admin/require-password-change-cleared.ts`),认标签即 403 + 中文原因 + 下一步入口。

## 🔴 后端不确定性(必须与本文一起读)

- 本工作区(`D:\WORKS\PLAN`)下**没有 Java 后端源码**(无 `nexion-backend`),因此**无法判定**后端是否已在每个高敏
  接口独立校验 `passwordChangeRequired`。**不得假设后端已做。**
  - 若后端已做 → 本次修复属纵深防御补齐,紧急度降。
  - 若后端未做 → 这是唯一闸门,修复前为零。
- cookie 里只有**不透明 accessToken**,BFF 解不出 session 内容,所以这层做不到「解出该字段再判断」。它只能做到
  「不主动下发全权凭证 + 认标签即拒」。**拿到 token 的人仍可绕过 BFF 直接打后端** —— 真正的强制力必须在后端。

## 机器门

| 门 | 位置 | 判据 |
|---|---|---|
| 接线哨兵 | `scripts/admin-auth-gate-sentinel.mjs`(已挂 `npm run verify` 齿轮 3) | 从磁盘枚举 `app/api/**/route.ts`;每条要么接闸门,要么在脚本内 EXEMPT 台账登记中文理由;接闸门 = 调用 + return + 位置在读 token 之前;台账条目必须真实存在且不得同时接闸门;签发路由必须条件化下发两个 cookie;拒绝文案必须运营可读;**基数台账 `MIN_GUARDED_ROUTES = 23`** 兜住「删路由」这个遍历判据看不见的方向 |
| 契约测试 | `tests/admin-auth-password-change-gate.test.mjs`(齿轮 4) | 闸门判定、拒绝文案链路、正常态放行、受限态改密/登出可达、哨兵自证(临时造一条未接闸门的路由必须被抓红) |

## 红测逐靶

还原方式:`cp` 备份 + sha256 校验(**全程未用 `git checkout`**)。注入未生效(锚点命中数不符 / 内容未变 /
破坏串仍在)一律抛错终止,不允许「以为注了其实没注」。每轮附一条正交对照门
`scripts/check-rbac-auth-source.mjs`,用来证明红是定点的而不是全局崩。

| 靶 | 注入的破坏 | 哨兵 | 契约测试 | 正交对照 | 还原后 |
|---|---|---|---|---|---|
| R1 | 摘掉 finance 路由的 guard 调用 | 🔴 点名 finance 未接闸门 + 基数 22<23 | 🔴 | 🟢 | 🟢 复绿 |
| R2 | guard 调了但摘掉 `return`(声明≠消费) | 🔴 点名「判定结果被丢弃」 | 🔴 | 🟢 | 🟢 复绿 |
| R3 | guard 挪到读 token 之后(接上了但不生效) | 🔴 点名顺序错 | 🔴 | 🟢 | 🟢 复绿 |
| R4 | login 恢复无条件下发全权 cookie | 🔴 点名「全权 cookie 不是条件下发」 | 🔴 | 🟢 | 🟢 复绿 |
| R5 | logout 不再清受限 cookie | 🔴 点名「残留标签长期锁死」 | 🔴 | 🟢 | 🟢 复绿 |
| R6 | 摘掉中文拒绝文案(只剩机器码) | 🔴 点名文案未登记 | 🔴 | 🟢 | 🟢 复绿 |
| R7 | 下线一条已接闸门的路由(改名下线,非删除) | 🔴 基数 22<23 | 🔴 | 🟢 | 🟢 复绿 |
| R8 | R1 破坏仍在 **+ 摘掉哨兵「未接闸门」判据本身** | 🟢 **转绿** | 🔴 | 🟢 | 🟢 复绿 |

- R8 是判据承重性验证:破坏依旧存在、只把哨兵的判据摘掉,哨兵就放行了 —— 证明 R1 的红确实由该判据产生,
  不是别的东西顺手抓到的假红。同轮契约测试仍红,说明两道门不是同一根判据的复制品。
- **R4/R5 第一次跑时哨兵是绿的**(只查了「文件里引用过这个符号」),被红测当场抓出假绿,已把判据收紧成
  「必须查到条件化下发 / 必须查到真的清空」后复跑才转红。哨兵脚本内保留了这两条踩坑注释。

## 用户可见行为

被拒时返回 403 + `ADMIN_PASSWORD_CHANGE_REQUIRED`,`lib/admin/error-messages.ts` 单源映射为:
「请先完成密码修改：当前账号还没有完成强制改密，后台功能已全部暂停。请退出后重新登录，在登录页的
「首次登录修改密码」步骤设置新密码，完成后即可继续操作。」—— 不是静默 401,也不是空白页。

正常(无需改密)登录与访问路径:闸门返回 `null` 直接放行,取 token 与 401 口径逐字未动。
