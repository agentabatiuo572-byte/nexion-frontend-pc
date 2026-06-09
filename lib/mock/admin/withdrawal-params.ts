/** D5 提现参数配置 mock。amplify 标识该参数朝哪个方向变动会"放大资金流出"(触发覆盖率红线核验)。 */
export interface WithdrawParam {
  key: string;
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  timing: string; // 生效时机
  anchor: string; // 前端锚点
  amplifyDir: "up" | "down" | null; // up=调高放大流出 / down=调低放大流出 / null=不影响流出
  phaseLinked?: boolean; // 是否随 12 月节奏 Phase 联动
  hint: string;
}

export const WITHDRAW_PARAMS: WithdrawParam[] = [
  {
    key: "dailyCapUsd", label: "单日提现上限", value: 5000, unit: "$", min: 1000, max: 20000, step: 500,
    timing: "实时", anchor: "§9.3.2", amplifyDir: "up",
    hint: "单个账户每日可提现上限。调高 = 放大资金流出。",
  },
  {
    key: "withdrawableRatioPct", label: "可提比例上限", value: 80, unit: "%", min: 50, max: 100, step: 5,
    timing: "仅新对象", anchor: "§9.3.2", amplifyDir: "up",
    hint: "账户余额中可申请提现的比例上限。调高 = 放大流出。",
  },
  {
    key: "feePct", label: "提现手续费率", value: 2.5, unit: "%", min: 0, max: 10, step: 0.5,
    timing: "实时", anchor: "§9.3", amplifyDir: "down",
    hint: "提现手续费率。调低 = 净流出增大(放大流出)。",
  },
  {
    key: "cooldownDays", label: "提现冷却期", value: 7, unit: "天", min: 0, max: 35, step: 1,
    timing: "实时", anchor: "§13.4.1", amplifyDir: "down", phaseLinked: true,
    hint: "两次提现之间的冷却天数。缩短 = 加速流出。随 Phase 联动。",
  },
  {
    key: "pointsThreshold", label: "提现积分门槛", value: 100, unit: "分", min: 0, max: 1000, step: 50,
    timing: "实时", anchor: "§9.3.2", amplifyDir: "down",
    hint: "发起提现所需的最低积分。调低 = 更多用户可提(放大流出)。",
  },
];
