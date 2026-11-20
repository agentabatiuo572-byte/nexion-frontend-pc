# 新TEST恢复既有HDPAY付款域名

2026-11-16，用户明确要求新TEST付款页白名单恢复原部署配置 `api.hdpayadmin.com,c.gmobvfxllc.com`，保留链接校验，并验证既有4300 USDT订单 `VQR-819DEEAD9D5B424790A6`。只改新TEST后端运行配置，不创建或付款新订单、不修改生产或main。

旧配置依据为 `D:/workspace/nexgrid-deploy/application-20260908-v2/ops/finalize-secrets.sh:63`；新TEST的11月14日配置回执只保留api.hdpayadmin.com。原4300单实际HDPAY创建响应为HTTP200、code200、msg为null，data为字符串；该单摘要绑定的AES-GCM数据解密后主机为c.gmobvfxllc.com。新服域名匹配失败，后端拒绝下发付款链接，订单进入SUBMIT_UNKNOWN；查询后的HDPAY_ORDER_QUERY_PENDING不能替代原创建拒绝原因。

本次仅恢复源站 `/srv/uvel-release/backend.env` 中 `NEXION_HDPAY_PAYMENT_PAGE_HOSTS` 为上述两个精确主机；其他配置保留。必要时单次重启API加载环境，保留受保护备份。API主机、回调、商户凭据、资金开关、业务数据与产品代码不调整。

付款地址仍须通过合法绝对URI、HTTPS、443或默认端口、无userinfo、无fragment以及精确主机匹配。保持后端原校验和App原页面交互；本次不使用通配域名、不开放任意付款地址。

验收按原订单核对恢复后的接口、付款页与二维码，并确认未新建订单或产生资金变更。原单如已过期、或服务商查询不提供恢复链接，记录实际限制，不延长有效期或手工改订单状态。配置恢复、服务端生效和原单页面验收分别记录，不提前宣称成功。

执行回执：2026-11-16 03:27:51 JST单次重启uvel-api后，实际进程已加载两个精确主机；仅目标环境行改变，其余字节保持，后端包及网关/Properties校验类哈希不变。源站备份目录 `/var/lib/uvel-change-evidence/hdpay-hosts-restore-20261116` 为root700、env备份和正式文件为root600。

原单实景结果分开记录：App刷新后该4300单仍为submit_unknown、paymentUrl缺失，尚未恢复自动付款入口。get/list仅叠加既有状态，不自动补回此前被拒的创建URL。对同一原单日志以订单/响应摘要绑定AAD解密，在浏览器内存直接打开原HDPAY地址，服务商Bank Payment页实际显示二维码和113477000 VND，未付款。此结果证明原服务商页面可用，不代表App旧单自动恢复通过；未重放创建请求、未手工改URL/订单状态、未另建订单。完整付款URL及令牌不写入PRD或证据。

03:31:41 JST 收尾核对：HDPAY订单/充值意图各4条、钱包1条、账本0条及钱包/账本稳定内容摘要均与操作前一致，没有新增订单或资金变更。独立只读复核已签收配置恢复、服务商原付款页可用与权限/资金边界，同时保留App旧单自动恢复未通过结论。证据目录 `D:/workspace/artifacts/aws-test/hdpay-4300-20261116/`；未运行单元/独立集成测试，未修改App页面或构建产品新包。
