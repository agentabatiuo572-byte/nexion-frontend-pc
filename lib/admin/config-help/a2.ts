/**
 * 操作记录与审批「机制设置」的配置项说明（CP-87、CP-88，DP-31）。按后端参数键取。
 * 页面行名用确认框那一套，后端行名（理由最短长度、日志保留期、记录字段、操作确认适用动作清单）不上屏（DT-14）。
 * 这几项只在后台写入和理由校验里用，App 不调这组接口，所以不写 App 位置。
 */

export interface A2MechanismHelp {
  /** 页面上的名字。 */
  label: string;
  /** 这是什么，不超过 25 字。 */
  what: string;
  /** 什么时候生效。 */
  when: string;
  /** 改了会怎样，静态的一句；随输入变的写在修改框里。 */
  effect?: string;
}

export const A2_MECHANISM_HELP: Record<string, A2MechanismHelp> = {
  reason_required: {
    label: "操作理由必填",
    what: "所有写操作都要填理由，不能关闭",
    when: "系统固定，一直生效",
  },
  ttl: {
    label: "操作理由最短长度",
    what: "确认框里的理由至少要写几个字",
    when: "保存后立即生效，之后打开的确认框按新值检查；已有记录不受影响",
    effect: "改成 12：之后每个确认框的理由少于 12 个可见字符就不能提交",
  },
  retention: {
    label: "操作记录保留期",
    what: "操作记录在线保留多少个月",
    when: "只对之后新写的记录生效，已有记录按自己的到期时间",
    effect: "改成 24：之后的新记录在线保留 24 个月，到期后先归档再移出列表",
  },
  schema: {
    label: "记录字段版本",
    what: "新写的操作记录用哪一版统一字段",
    when: "升级后新记录带新版本号，历史记录不改",
    effect: "升到 v4：之后的新记录和导出里的「Schema 版本」列写 v4",
  },
  confirm_list: {
    label: "需要确认的操作",
    what: "哪些操作要单独确认的分类说明",
    when: "只读说明，不改变各操作的权限和审批",
  },
};

/** 五项都只影响后台操作人和记录。 */
export const A2_MECHANISM_WHERE = "用户看不到，只影响后台";
