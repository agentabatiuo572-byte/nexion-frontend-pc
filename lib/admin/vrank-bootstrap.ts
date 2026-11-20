export const bootstrapRankCodes = Array.from({ length: 9 }, (_, index) => `V${index}`);

export type VRankBootstrapDraft = {
  rankCode: string;
  titleCn: string;
  titleEn: string;
  selfComputePoints: string;
  directRefs: string;
  teamComputePoints: string;
  requiredDownlineRank: string;
  requiredDownlineCount: string;
  unilevelDepth: string;
  peerBonusPercent: string;
  leadershipVotes: string;
};

export function emptyVRankBootstrap(): VRankBootstrapDraft[] {
  return bootstrapRankCodes.map((rankCode) => ({ rankCode, titleCn: "", titleEn: "", selfComputePoints: "",
    directRefs: "", teamComputePoints: "", requiredDownlineRank: "", requiredDownlineCount: "",
    unilevelDepth: "", peerBonusPercent: "", leadershipVotes: "" }));
}

export function buildVRankBootstrap(drafts: VRankBootstrapDraft[]) {
  if (drafts.length !== 9) throw new Error("请完整配置 V0–V8");
  return drafts.map((draft, index) => {
    const fail = (message: string): never => { throw new Error(`V${index} · ${message}`); };
    if (draft.rankCode !== `V${index}`) fail("等级顺序不正确");
    const title = (value: string, label: string) => {
      const text = value.trim();
      if (!text || text.length > 64) fail(`${label}须填写 1–64 个字符`);
      return text;
    };
    const integer = (value: string, label: string, max: number) => {
      if (!/^\d+$/.test(value.trim())) fail(`${label}须明确填写非负整数`);
      const number = Number(value.trim());
      if (!Number.isSafeInteger(number) || number > max) fail(`${label}超出可用范围`);
      return number;
    };
    const selfComputePoints = integer(draft.selfComputePoints, "自购算力点", Number.MAX_SAFE_INTEGER);
    const directRefs = integer(draft.directRefs, "直接邀请人数", 2147483647);
    const teamComputePoints = integer(draft.teamComputePoints, "团队算力点", Number.MAX_SAFE_INTEGER);
    const requiredDownlineCount = integer(draft.requiredDownlineCount, "达标分支数", 2147483647);
    const leadershipVotes = integer(draft.leadershipVotes, "团队激励池票数", 2147483647);
    const requiredDownlineRank = draft.requiredDownlineRank || null;
    if (requiredDownlineCount === 0 ? requiredDownlineRank !== null
      : requiredDownlineRank === null || !bootstrapRankCodes.slice(0, index).includes(requiredDownlineRank)) {
      fail("有达标分支时请选择低于本级的分支等级；分支数为 0 时选择“不要求”");
    }
    if (index > 0 && selfComputePoints + directRefs + teamComputePoints + requiredDownlineCount === 0) {
      fail("至少填写一项大于 0 的晋升条件");
    }
    if (!/^(?:0|L1(?:-L[1-7])?)$/.test(draft.unilevelDepth)) fail("请选择团队购买奖励范围");
    const percent = draft.peerBonusPercent.trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(percent) || Number(percent) > 100) fail("同级奖比例须为 0–100%，最多两位小数");
    return { rankCode: draft.rankCode, titleCn: title(draft.titleCn, "中文头衔"), titleEn: title(draft.titleEn, "英文头衔"),
      selfComputePoints, directRefs, teamComputePoints, requiredDownlineRank, requiredDownlineCount,
      unilevelDepth: draft.unilevelDepth, peerBonusRate: Number((Number(percent) / 100).toFixed(4)), leadershipVotes, rewards: [] };
  });
}

export type VRankBootstrapRow = ReturnType<typeof buildVRankBootstrap>[number];
