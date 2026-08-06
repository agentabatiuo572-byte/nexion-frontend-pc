/**
 * 高敏写操作失败的**统一归类口径**(全仓单源)。
 *
 * 要回答的只有一个问题:这次失败之后,**在途的那个命令号还能不能留着重试**?
 *
 * - 留着(结果未知)—— 后端可能已经落库。同号重试 = 后端按 Idempotency-Key 去重,最多是一次
 *   干净重放;换新号重试 = 后端看成第二条命令 = **重复入账 / 重复打款**。
 * - 丢掉(确定性拒绝)—— 服务端明确拒绝了,这次没有任何副作用,号留着反而会让下一次真实提交
 *   被幂等回放吞掉。
 *
 * 🔴 判据(2026-08-06 主人拍板统一,原先舰队里有三套口径):
 *     确定性拒绝 ⇔ 4xx  ∨  (2xx 且业务码 ≠ 0)
 *     其余一律「结果未知」:5xx / 传输层失败 / 响应不可读 / 上游 outcome=unknown。
 *
 * why 5xx 归「未知」而不是「失败」——这是**优势策略**,不需要先验证后端实现:
 *   · 若后端契约成立(开发落地规格 §0.4:写入失败则目标域无副作用、幂等记录与高敏写同事务),
 *     5xx ⇒ 已回滚 ⇒ 保号重试零代价;
 *   · 若后端有「提交后才 500」的实现瑕疵,保号重试会被去重挡住 ⇒ **防住资金动作双发**。
 *   两种世界里保号都不劣于弃号,而弃号在第二种世界里是双倍打款。
 *
 * 附带效果:`X-Nexion-Upstream-Outcome: unknown` 头从「唯一保险丝」降级为增强信号 ——
 * 代理漏打这个头不再是致命单点(它只是让分类更早发生,不再是分类的唯一依据)。
 *
 * 仓内范本:`i-client.ts` 早就是这个口径(`res.status < 500 && isWrite` 才 forget)。
 */

/**
 * 这次 HTTP 失败是不是「确定性拒绝」(可以安全丢弃在途命令号)。
 *
 * @param status   HTTP 状态码
 * @param apiCode  业务返回码(`ApiResult.code`);2xx 里非 0 表示业务层明确拒绝
 */
export function isDeterministicRejection(status: number, apiCode?: number | null): boolean {
  if (status >= 400 && status < 500) return true;
  if (status >= 200 && status < 300 && typeof apiCode === "number" && apiCode !== 0) return true;
  return false;
}

/**
 * 这次 HTTP 失败之后,在途命令号必须保留吗?(= `!isDeterministicRejection`)
 *
 * 单独给一个名字是因为调用点读起来就是这个语义(「要不要 forget」),
 * 写成 `!isDeterministicRejection(...)` 每处都要读者在脑子里取反一次。
 */
export function outcomeStaysUnknown(status: number, apiCode?: number | null): boolean {
  return !isDeterministicRejection(status, apiCode);
}
