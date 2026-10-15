# 客户消息链待测说明

更新日期：2026-10-15。状态：**明确暂缓，待同事验收，未PASS**。
对应原ID：M3-14/15/16；UX-05/RANK-12需要客户新回复的子项。其它非发送资料/工具仍按[总交接](support-center-handoff-20261014.md)验收。
协议源：[M3实时通信契约](../PRD/M3-会话实时通信契约.md)；产品边界：[M功能契约](../PRD/M-专属客服中心功能契约.md)；[原验收](../specs/support-analytics-20261006/ACCEPTANCE.md)。不重复协议算法，不以交接替代执行。

## 1. 固定对象和版本

- 客户2005、专属客服1456；会话`CV-OUT-20261013145107836`，原消息7675。后台身份不能代客户身份。
- 2026-10-15已对该会话完成后台归档及撤销的正常往返，最终OPEN、archived=0、version=2，新增2条系统记录和2条审计，原客服消息仍为1条。接续时重新读取版本，不能继续硬编码version=0；此操作不构成客户消息链通过。
- FE当前交付为[PR17](https://github.com/agentabatiuo572-byte/nexion-frontend-pc/pull/17)，test合并`ad399277f65af936c1a12fa10c0941f765f21f63`；最近生产构建及98项检查见[局部验收记录](support-self-rank-20261015.json)。原消息证明仍保留当时源码归属，不重签为新版本消息链通过。
- BE当前交付为[PR9](https://github.com/agentabatiuo572-byte/nexion-backend/pull/9)，test合并`d10d36bbb5045287834adf50ae9bfcfb6c2ba3ef`；原生产业务验收源码`c37c582e6acec2547fd11c8a5d37737bb02775a5`的证明继续沿用原边界。
- APP已通过[PR2](https://github.com/agentabatiuo572-byte/nexion-frontend-uniapp/pull/2)合入test，`1ed9d845865d23050fcfab39d0bfaa107a573252`；H5镜像已通过[PR3](https://github.com/agentabatiuo572-byte/nexion-frontend-prototype/pull/3)合入H5，`049a1835f79ce7cb2e0d4c8ebf578d87b88baedb`。两工程均有23项完整门证明，镜像同步不再阻塞交付；见[APP交接](https://github.com/agentabatiuo572-byte/nexion-frontend-uniapp/blob/test/docs/acceptance/support-center-handoff-20261014.md)与[四仓交付快照](support-delivery-20261015.json)。接续前核当前提交、`src/api/auth-api.ts`、`src/api/support-api.ts`及实际构建，代码已交付不等于客户消息链已验。
- 唯一隔离库`127.0.0.1:33338/cs_analytics_20261007`，UUID`abe359c0-c621-11f1-97ea-a40c6626953d`；FE33108/BE18162均只用任务专属服务。原33337来源库不修改。

## 2. 已证与仍缺

已证：原7675发送、原AppSupportService事务sent→read、客服STATUS、刷新仍已读；既有游标、幂等和恢复单测可复用。原回执明确`customer-login-not-tested`，不再发送消息或重跑资金来重复这些断言。

未证：正常客户认证→正常客户controller接收/打开/read→客服STATUS→双方刷新；同ID受控断开/恢复、未知结果恢复、已读不倒退及sending/unknown/failed真实状态。7675已读，只能证明保持；若必须证明新的真实客户sent→read，需另有明确的新消息授权，不把旧消息改回未读或用另一ID掩盖原问题。

## 3. 接续前置与停止条件

1. 重核库UUID、源码、客户2005的当前绑定、状态、2FA/改密要求与grants。旧读取为ACTIVE、sandbox0、未删除、2FA0、无需强制改密；这些会变化，不能省略现查。
2. 获取合法客户认证输入或现成正常客户会话；目前没有可携带认证凭据。验证码、密码、密钥、token只经私密受控渠道，不进入仓库、截图、日志或报告。
3. 如需找回，正常入口为`POST /auth/users/password-reset/otp/send`→`/otp/complete`→`/auth/users/login`；complete不直接创建登录session。后台password-reset只标强制改密并撤销会话，不返回临时密码，不能单独解决客户登录。
4. 受控隔离启动需核实际dev profile/本地测试OTP交付，保持外部短信关闭；现有源码配置不能代有效运行值。保留captcha、速率与2FA检查，不关闭安全要求。
5. 密码变更、会话撤销、认证写权限需先有合法授权。停止本次依赖准备，不从这份文档自动获得增权/重置/OTP发送权限。

已定位的权限缺项仅供接续确认，不是GRANT指令；实际账号及权限重新核验：

| 表 | 待确认操作 |
| --- | --- |
| nx_user_security | INSERT、UPDATE |
| nx_user_session | INSERT、UPDATE |
| nx_user_login_guard | UPDATE、DELETE |
| nx_user_otp_challenge | INSERT、UPDATE |
| nx_user_otp_send_event | INSERT |
| nx_support_activity_event | INSERT |
| nx_support_activity_state | SELECT、INSERT、UPDATE |

共7表13项；login_guard的DELETE仅是合法成功登录清理该身份临时限流，不删除OTP/审计/消息历史。禁止临时增DDL或使用root运行产品。

登录会写有效活动事件/状态，可能改变客服统计；旧读没有activity_state或OPEN维护周期，不保证接续时仍如此。若已有OPEN周期，正常业务可能还需maintenance_cycle UPDATE并结为SUCCEEDED，必须先确认业务影响及权限，不故意关闭维护绕过条件。前置未满足、身份/绑定变化、出现新权限依赖、验证码实际外发或服务异常时停止，不反复尝试。

## 4. 最小验收步骤

1. 通过正常login读回身份确为2005；如有2FA/改密门按正常流程完成。
2. 打开固定会话，核消息7675及现有已读状态；不自动发新消息。
3. 经`POST /api/app/support/conversations/{conversationNo}/read`读取并重放同一lastSeenMessageId，保存controller返回和该消息状态。
4. 客服端观察同一会话STATUS；双方刷新后仍为同ID/不重复/已读不倒退。
5. 同一会话做一次受控断开与恢复，核恢复窗口和未知结果仍沿原命令/消息ID；不新增第二条消息替代原ID。
6. 原ID逐断言标PASS/FAIL/UNVERIFIED；没有新sent→read就保留该子项未证，另附合法授权后的新场景结果。旧事务证明不升级为正常客户E2E。

禁止自签JWT、后台token冒充客户、SQL改密码hash/已读历史、直接业务方法替controller或fixture冒充真实页面。阅读不算回复或维护成功。

## 5. 结果交付

在总交接预留证据目录增加脱敏客户认证身份摘要、controller/read/STATUS与双方刷新、断开恢复步骤及源码/服务绑定；保留原`read-receipt-result.json`的服务事务边界。不给出真实认证值或完整私有日志。
停止本任务专属服务并保存after，保留尚有依赖的隔离库。只签实际执行子项，客户链暂缓状态在取得运行证明前不改为通过。
