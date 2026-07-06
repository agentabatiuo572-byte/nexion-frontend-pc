/**
 * E6 算力与设备配置 — 平台开关 / 在线系数 / 电脑显卡映射 / 下载内容(mock,backend-replaceable)。
 *
 * 三端改造 SPEC-0「前后端一致脊柱」:本寄存器与 uniapp 端结构对齐 ——
 *   - uniapp:`src/store/config-types.ts`(FeatureFlagKey / FeatureFlags)+ `src/store/config.ts`(useConfig.isEnabled)
 *     + `src/mock/platform-config.ts`(DEFAULT_PLATFORM_CONFIG.featureFlags)。
 *   - admin:后台改 flag → setParam(`E.compute.<key>`, "on"|"off") + A2 审计;读 flag 走 pget 派生。
 * DR-7:本期 admin 改 flag 与 uniapp 读 flag 各自 mock,结构一致即可,不真打通后端。
 *
 * PROD(真后端替换点,结构 1:1 映射):
 *   - 读:GET  /api/admin/config/feature-flags        → { key: ComputeFlagKey; enabled: boolean }[]
 *   - 改:PATCH /api/admin/config/feature-flags/:key   body { enabled: boolean; reason: string }(Idempotency-Key 幂等)
 */

// 平台 feature flag 唯一 id —— 与 uniapp `FeatureFlagKey` 同名,跨端一致(单一标识)。
export type ComputeFlagKey = "computeShareEnabled";

export interface ComputeFlagDef {
  key: ComputeFlagKey;      // 跨端一致的 flag 唯一 id
  label: string;            // 运营可读中文名(运营面主标)
  desc: string;             // 用途说明(运营面)
  defaultOn: boolean;       // 默认态 —— 须与 uniapp DEFAULT_PLATFORM_CONFIG.featureFlags 对齐
  frontendEffect: string;   // 开启对用户端的影响(确认弹窗 + 脚注引用)
}

// flag 寄存器:SPEC-0 仅 1 个示范 flag;后续 SPEC 按需在此追加(单一来源,视图派生不另列)。
export const COMPUTE_FLAGS: ComputeFlagDef[] = [
  {
    key: "computeShareEnabled",
    label: "电脑共享算力入口",
    // 对齐 uniapp DEFAULT_PLATFORM_CONFIG.featureFlags.computeShareEnabled = false(DR-1 默认 OFF)。
    defaultOn: false,
    desc: "控制客户端『电脑共享算力』PC 弱入口与下载页的显隐。",
    frontendEffect: "开启后客户端显现电脑算力 PC 入口与下载页;关闭则隐藏。",
  },
];

// admin params 存储键前缀(E 域 feature-flag 命名空间;与 E.gen.* / E.device.* / E.tradein.* 不冲突)。
export const COMPUTE_PARAM_PREFIX = "E.compute.";
export const computeFlagParamKey = (key: ComputeFlagKey): string => `${COMPUTE_PARAM_PREFIX}${key}`;

// ── SPEC-1 在线加成系数(载体在线分层 · 数值参数)──────────────────────────
// 运营在 E6 调的数值系数(非布尔开关)。与 uniapp PlatformConfig.onlineBonus 同 key
// (h5BaseFactor / continuityFullHours),共用 E.compute.* 前缀。DR-7:各端各自 mock,
// 结构/键一致即可,PROD 服务端下发;改值走 setParam → A2 审计。
export interface ComputeCoefficientDef {
  key: "h5BaseFactor" | "continuityFullHours";
  label: string; // 运营可读中文
  defaultVal: number; // 对齐 uniapp DEFAULT_PLATFORM_CONFIG.onlineBonus
  unit: string; // 单位 / 取值范围
  placeholder: string; // 输入示例
  desc: string; // 用途
  frontendEffect: string; // 改后用户端效果
}

export const COMPUTE_COEFFICIENTS: ComputeCoefficientDef[] = [
  {
    key: "h5BaseFactor",
    label: "H5 基础托管系数",
    defaultVal: 0.6,
    unit: "× 基线 · 取值 0–1",
    placeholder: "0.6",
    desc: "H5(网页非常驻载体)按基准产出 × 此系数计算基础托管产出,不叠加充电 / 散热 / 连续在线在线加成。",
    frontendEffect: "调高=H5 基础托管产出更高(与 App 差距缩小);调低=放大 App 在线加成优势,强化「升级 App」转化。",
  },
  {
    key: "continuityFullHours",
    label: "连续在线满额时长",
    defaultVal: 2,
    unit: "小时",
    placeholder: "2",
    desc: "App 载体连续在线达此时长后,稳定性加成因子升至满额 1.0(此前自 0.85 线性爬升)。",
    frontendEffect: "调短=用户更快拿到满额在线加成;调长=需更久连续在线才满额,强化持续在线激励。",
  },
];

export type ComputeCoefficientKey = ComputeCoefficientDef["key"];
export const computeCoeffParamKey = (key: ComputeCoefficientKey): string => `${COMPUTE_PARAM_PREFIX}${key}`;

// ── E6 收益估算系数(mock seed,backend-replaceable)────────────────────────
// PROD 替换点:
//   - 读:GET  /api/admin/config/compute-share/yield-estimate
//   - 改:PATCH /api/admin/config/compute-share/yield-estimate/:key body { value: number; reason: string }
export interface ComputeYieldEstimateDef {
  key: "topsBaseline" | "dailyUsdtPerBaseline" | "nexPerUsdt";
  label: string;
  defaultVal: number;
  unit: string;
}

export const COMPUTE_YIELD_ESTIMATE: ComputeYieldEstimateDef[] = [
  { key: "topsBaseline", label: "收益估算基准算力", defaultVal: 28, unit: "TOPS" },
  { key: "dailyUsdtPerBaseline", label: "基准日产 USDT", defaultVal: 0.06, unit: "USDT / 日" },
  { key: "nexPerUsdt", label: "NEX 折算系数", defaultVal: 166.67, unit: "NEX / USDT" },
];

export type ComputeYieldEstimateKey = ComputeYieldEstimateDef["key"];
export const computeYieldEstimateParamKey = (key: ComputeYieldEstimateKey): string =>
  `${COMPUTE_PARAM_PREFIX}yieldEstimate.${key}`;

// ── SPEC-2 电脑显卡映射表(G1-G6)────────────────────────────────────────
// 与 uniapp src/lib/gpu-tiers.ts 默认值保持同构。后台展示中文业务名;跨端下发时使用 id/tops/keywords。
// PROD 替换点:
//   - 读:GET  /api/admin/config/compute-share/gpu-tiers
//   - 改:PATCH /api/admin/config/compute-share/gpu-tiers/:id
//        body { label?: string; tops?: number; keywords?: string[]; reason: string }
export type ComputeGpuTierId = "G1" | "G2" | "G3" | "G4" | "G5" | "G6";
export type ComputeGpuTierField = "label" | "tops" | "keyword1" | "keyword2" | "keyword3" | "keyword4" | "keyword5" | "keyword6";

export interface ComputeGpuTierDef {
  id: ComputeGpuTierId;
  label: string;
  desc: string;
  defaultModel: string;
  defaultTops: number;
  keywords: string[];
}

export const COMPUTE_GPU_KEYWORD_SLOTS: Extract<ComputeGpuTierField, `keyword${number}`>[] = [
  "keyword1",
  "keyword2",
  "keyword3",
  "keyword4",
  "keyword5",
  "keyword6",
];

export const COMPUTE_GPU_TIERS: ComputeGpuTierDef[] = [
  {
    id: "G1",
    label: "入门显卡",
    desc: "集显或旧独显,只放轻量任务。",
    defaultModel: "Intel Iris Xe",
    defaultTops: 40,
    keywords: ["gtx 1650", "gtx 1060", "gtx 1050", "integrated", "iris xe", "vega"],
  },
  {
    id: "G2",
    label: "标准显卡",
    desc: "主流入门独显,也是未知型号的保守兜底档。",
    defaultModel: "NVIDIA RTX 3060",
    defaultTops: 90,
    keywords: ["rtx 3060", "rtx 3050", "rtx 2060", "gtx 1080", "rx 6600"],
  },
  {
    id: "G3",
    label: "进阶显卡",
    desc: "中端独显,可承接更长的推理任务。",
    defaultModel: "NVIDIA RTX 4060",
    defaultTops: 160,
    keywords: ["rtx 4060 ti", "rtx 4060", "rtx 3070", "rx 7600", "rx 6700"],
  },
  {
    id: "G4",
    label: "高阶显卡",
    desc: "高性能个人显卡,默认演示型号落在此档。",
    defaultModel: "NVIDIA RTX 4070",
    defaultTops: 290,
    keywords: ["rtx 4070 ti", "rtx 4070", "rtx 3080", "rx 7800"],
  },
  {
    id: "G5",
    label: "超高阶显卡",
    desc: "高端工作站或旗舰上一代独显。",
    defaultModel: "NVIDIA RTX 4080",
    defaultTops: 460,
    keywords: ["rtx 5080", "rtx 4080", "rx 7900", "a5000"],
  },
  {
    id: "G6",
    label: "旗舰显卡",
    desc: "旗舰显卡或数据中心卡,仅承接高收益任务。",
    defaultModel: "NVIDIA RTX 4090",
    defaultTops: 660,
    keywords: ["rtx 5090", "rtx 4090", "h100", "a100", "l40"],
  },
];

export const computeGpuTierParamKey = (id: ComputeGpuTierId, field: ComputeGpuTierField): string =>
  `${COMPUTE_PARAM_PREFIX}gpuTier.${id}.${field}`;

// ── SPEC-2 客户端下载配置───────────────────────────────────────────────
// URL 单独编辑;双语展示文案用 multi-field 一次编辑,避免在 UI 单框里塞多值。
// PROD 替换点:
//   - 读:GET  /api/admin/config/compute-share/download-content
//   - 改:PATCH /api/admin/config/compute-share/download-content
export type ComputeDownloadField = "url" | "zhTitle" | "zhGuide" | "enTitle" | "enGuide";

export const COMPUTE_DOWNLOAD_CONTENT: Record<ComputeDownloadField, { label: string; defaultVal: string; placeholder: string }> = {
  url: {
    label: "客户端下载地址",
    defaultVal: "",
    placeholder: "https://download.example.com/nexion-pc/latest",
  },
  zhTitle: {
    label: "中文标题",
    defaultVal: "电脑显卡算力共享",
    placeholder: "电脑显卡算力共享",
  },
  zhGuide: {
    label: "中文说明",
    defaultVal: "下载桌面客户端,使用同一账号登录,连接后电脑会出现在设备仓库中。",
    placeholder: "说明下载、登录与连接后的展示位置",
  },
  enTitle: {
    label: "英文标题",
    defaultVal: "Computer GPU share",
    placeholder: "Computer GPU share",
  },
  enGuide: {
    label: "英文说明",
    defaultVal: "Download the desktop client, sign in with the same account, and the computer appears in device inventory after connection.",
    placeholder: "Explain download, sign-in, and inventory placement",
  },
};

export const computeDownloadParamKey = (field: ComputeDownloadField): string =>
  `${COMPUTE_PARAM_PREFIX}download.${field}`;
