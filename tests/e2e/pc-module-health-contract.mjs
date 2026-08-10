export const fatalModuleTextPatterns = [
  /平台参数服务返回异常/i,
  /权限目录加载失败/i,
  /model\.weights\s*数据不完整/i,
  /数据加载失败/i,
  /加载失败\s*·/i,
  /Handler dispatch failed/i,
  /NoSuchMethodError/i,
  /SQLSyntaxErrorException/i,
  /BACKEND_UNAVAILABLE/i,
  /Cannot read properties/i,
  /ReferenceError/i,
  /TypeError/i,
  /接口读取失败/i,
  /真实接口不可用/i,
  /暂时不可用/i,
  /同步失败/i,
  /协议错误/i,
  /一致性校验未通过/i,
  /mock 用户详情/i,
  /localStorage/i,
];

const allowedOperationalAlerts = {
  B3: [
    /^当前漏斗不可安全计算\s*[:：]?\s*当前筛选范围没有可确认的注册用户\s*[，,]\s*转化率不可计算\s*[；;]\s*请检查\s*A4\s*注册事件或调整筛选条件[。.]?$/i,
  ],
  J1: [
    /^\d+\s*项自动关停结论已逾期未补录\s*——\s*闸已止血\s*[,，]\s*但处置理由仍空缺\s*[;；]\s*逾期事项不会自行消失\s*[,，]\s*请值班人员立即补录\s*[,，]\s*或上报值班主管接手[。.]?(?:\s*·\s*[^·\r\n]+?\(截止\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\))+\s*$/i,
  ],
};

const terminalBusinessErrorPattern = /^(?:⚠️|错误|异常|失败|服务端|后台|平台参数|权限目录|页面|数据|业务规则|接口|请求|操作|加载|读取|保存|提交|导出|同步).{0,80}(?:失败|异常|错误|冲突|不可用|无法|未通过|不完整|超时|断开|拒绝|暂不可)|(?:失败|异常|错误|冲突|不可用|无法|未通过|不完整|超时|断开|拒绝|暂不可).{0,80}(?:请刷新|请稍后|请重试|请联系|联系管理员|稍后再试|已停止展示)/i;
const terminalContractViolationPattern = /(?:服务(?:端)?|后台|平台|接口|请求|响应|返回|数据|字段|结果|页面).{0,100}(?:不符合(?:约定|契约|协议)|缺少(?:必填|必需|必要)?字段|字段(?:缺失|不完整)|格式(?:异常|错误|无效)|响应(?:畸形|无效)|契约(?:失败|不符)).{0,100}(?:已?停止(?:展示|渲染|使用)|页面已停止展示|不再展示|无法展示|拒绝展示|关闭(?:展示|写入|操作))/i;
const terminalStoppedRenderingPattern = /(?:已损坏|不可信|空响应|重复(?:的)?|不一致|不完整|缺少(?:必填|必需|必要)?字段|格式(?:异常|错误|无效)|暂时不可用|不符合(?:约定|契约|协议)).{0,120}(?:已?停止(?:展示|报价|渲染|使用)|页面已停止展示|不再展示|无法展示|拒绝展示|关闭(?:展示|写入|操作))/i;
const terminalCapabilitySuppressionPattern = /(?:当前不可用|暂时无法同步|协议校验失败).{0,160}(?:页面已停止写入|写操作(?:也)?已关闭|不会开放(?:新建或转交)?(?:写)?操作|当前不展示|已进入只读保护|已停止渲染)/i;
const terminalProtocolFailureTitlePattern = /^(?:[A-M]\d+\s*)?.{0,40}(?:响应)?协议校验失败$/i;
const terminalSuppressedOutcomePattern = /(?:缺失|未确认|失败|异常|不可用|不完整|不一致).{0,140}(?:已停止(?:加载|展示|使用|进入|写入|渲染)|写操作(?:也)?已关闭)|^(?:[A-M]\d+\s*)?(?:系统|资金账本|页面|数据|业务)?.{0,40}已停止(?:加载|展示|使用|进入|写入|渲染)/i;
const terminalHiddenCapabilityPattern = /(?:不可用|异常|不完整|不一致|相互矛盾|读取失败|无法确认|未获得|未确认).{0,160}(?:(?:控制项|旧数据(?:与写操作)?|规则与写操作|旧值|所有操作|全部写操作).{0,24}(?:已隐藏|已清空|均已停用|保持冻结)|(?:页面)?已隐藏(?:规则与写操作|控制项|旧数据(?:与写操作)?))|(?:已隐藏旧数据与写操作|旧值已清空.{0,40}写操作保持冻结|旧数据已清空.{0,40}操作均已停用)/i;
const terminalUnavailableStateTitlePattern = /^当前无法确认.{0,40}(?:状态|数据|配置)$/i;
const terminalIssueWithSuppressionPattern = /(?:失败|异常|不可用|无法(?:确认)?|不完整|不一致|相互矛盾|未获得|未确认|缺失|为空|不可信|错误).{0,180}(?:(?:页面|系统|全部|所有|控制项|旧数据|旧值|写操作|入口|模拟|改角色|数据)?(?:已|均已)(?:停止|关闭|隐藏|清空|冻结|停用|禁用)|当前不会开放|不会开放|保持冻结|已按.{0,30}关闭|拒绝(?:展示|使用|提交)|不提供.{0,20}入口)/i;
const terminalReadFailurePattern = /(?:读取|加载|同步|请求).{0,30}(?:失败|异常).{0,120}(?:未更新|未加载|未读取|未同步|未显示旧数据)/i;
const terminalDirectReadFailurePattern = /(?:^|[·:：，,；;])(?:[A-M]\d+\s*)?.{0,50}(?:读取|加载|同步|查询|接口|服务|目录|响应).{0,30}(?:失败|异常|不可用|不完整|不一致|无法确认)\s*(?:[·:：，,；;。.]|$)/i;
const terminalRefreshFailurePattern = /(?:^|[·:：，,；;])(?:[A-M]\d+\s*)?(?:后端|数据|页面|列表|配置|状态|KPI)?\s*刷新(?:读取)?(?:失败|未成功)\s*(?:[·:：，,；;。.]|$)/i;
const terminalSubreadUnavailablePattern = /(?:^|[·:：，,；;])(?:[A-M]\d+\s*)?.{0,60}(?:历史|趋势|明细|详情|告警|统计|预算|资金流|新增入金).{0,30}暂不可用\s*(?:[·:：，,；;。.]|$)/i;
const terminalIncompleteOperationPattern = /^(?:操作|请求|任务|处置|变更).{0,30}(?:未完成|未成功|结果未知|状态未知).{0,120}(?:请刷新|请重试|联系值班|核对)/i;
const operationalGuidancePattern = /失败时|失败后|若.{0,12}失败|如果.{0,12}失败|异常时|不可用时|失败关闭|请确保|用于说明|不会用|不会以|不得以|不应以|缺失.{0,24}(?:标为)?不可用|标为不可用/i;

export function isUnmarkedBusinessErrorText(value) {
  const text = value.replace(/\s+/g, " ").trim();
  const strongTerminalFailure = terminalCapabilitySuppressionPattern.test(text)
    || terminalProtocolFailureTitlePattern.test(text)
    || terminalSuppressedOutcomePattern.test(text)
    || terminalHiddenCapabilityPattern.test(text)
    || terminalUnavailableStateTitlePattern.test(text)
    || terminalIssueWithSuppressionPattern.test(text)
    || terminalReadFailurePattern.test(text);
  const heuristicTerminalFailure = terminalBusinessErrorPattern.test(text)
    || terminalContractViolationPattern.test(text)
    || terminalStoppedRenderingPattern.test(text)
    || terminalDirectReadFailurePattern.test(text)
    || terminalRefreshFailurePattern.test(text)
    || terminalSubreadUnavailablePattern.test(text)
    || terminalIncompleteOperationPattern.test(text);
  return text.length > 0
    && text.length <= 300
    && (strongTerminalFailure || (heuristicTerminalFailure && !operationalGuidancePattern.test(text)));
}

export function evaluateModuleHealthSnapshot(moduleId, snapshot) {
  const failures = [];
  const text = snapshot.text.trim();
  const hasSubstantiveContent =
    text.length >= 100
    && snapshot.headingCount > 0
    && (
      snapshot.landmarkCount + snapshot.controlCount >= 2
      || text.length >= 300
    );

  if (!hasSubstantiveContent) {
    failures.push(
      `substantive content missing: text=${text.length}, headings=${snapshot.headingCount}, landmarks=${snapshot.landmarkCount}, controls=${snapshot.controlCount}`,
    );
  }
  if (snapshot.visibleLoadingCount > 0) {
    failures.push(`persistent loading indicators: ${snapshot.visibleLoadingCount}`);
  }
  if (snapshot.semanticErrorScanComplete !== true) {
    failures.push("semantic error scan missing");
  }
  if (snapshot.terminalErrorMarkerCount > 0) {
    failures.push(`terminal error markers: ${snapshot.terminalErrorMarkerCount}`);
  }

  const unmarkedBusinessErrors = Array.isArray(snapshot.unmarkedBusinessErrorTexts)
    ? snapshot.unmarkedBusinessErrorTexts.map((value) => value.trim()).filter(Boolean)
    : [];
  if (unmarkedBusinessErrors.length > 0) {
    failures.push(`unmarked business error: ${unmarkedBusinessErrors.join(" | ")}`);
  }

  const fatalPattern = fatalModuleTextPatterns.find((pattern) => pattern.test(text));
  if (fatalPattern) failures.push(`fatal text matched: ${fatalPattern}`);

  const allowed = allowedOperationalAlerts[moduleId] ?? [];
  const unexpectedAlerts = snapshot.alertTexts
    .map((alert) => alert.trim())
    .filter(Boolean)
    .filter((alert) => !allowed.some((pattern) => pattern.test(alert)));
  if (unexpectedAlerts.length > 0) {
    failures.push(`unexpected role=alert: ${unexpectedAlerts.join(" | ")}`);
  }

  return failures;
}
