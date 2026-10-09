import test from 'node:test';import assert from 'node:assert/strict';
import {formatAdminApiError,displayAdminError} from '../lib/admin/error-messages.ts';
const cases={
 SUPPORT_RECOVERY_FACTS_UNAVAILABLE:/当前授权范围.*无法读取.*结果仍待确认.*原命令.*不要重复提交/,
 SUPPORT_RECOVERY_FACTS_CHANGED:/客户绑定或版本已变化.*结果尚未完成核对.*原命令.*继续查询/,
 READ_IDENTITY_CHANGED:/读取已取消.*账号及查看范围已变化.*旧资料不能用于确认结果.*获准范围.*已提交的操作.*查询原结果/,
 MAINTENANCE_READBACK_MISMATCH:/维护调整后的资料.*不一致.*结果尚未确认.*原命令.*不要重复提交/,
 MAINTENANCE_RECOVERY_FACTS_CHANGED:/客户归属或维护状态已变化.*原维护结果尚未核对.*原命令.*继续查询/,
 TARGET_UNAVAILABLE:/目标客服组当前不可用.*读取获准组范围.*选择可用组/,
 SUPPORT_ROUTE_RECOVERY_FACTS_CHANGED:/客户当前组范围.*不一致.*结果尚未完成核对.*原命令.*继续查询/,
 MANAGEMENT_SCOPE_REQUIRED:/没有客服组管理范围.*返回本人工作台.*主管资格及负责组/,
};
test('all eight support recovery errors translate through the real throat with distinct authorized next steps',()=>{
 const outputs=[];for(const[code,pattern]of Object.entries(cases)){const copy=formatAdminApiError(code,'fallback');assert.match(copy,pattern,code);assert.equal(displayAdminError(new Error(code)),copy);assert.equal(formatAdminApiError(code+':privateField','fallback'),copy);assert.match(copy,/[\u4e00-\u9fff]/);assert.doesNotMatch(copy,/[A-Z]{3,}(?:_[A-Z]+)+|privateField|未生效|未提交|未执行|已回滚|已失败|可重发|重新提交|原样重试|同号重试|请.*后重试/);outputs.push(copy);}assert.equal(new Set(outputs).size,8);
});
