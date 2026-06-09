/**
 * 后台模块内容规格 — 注册表条目的数据形状。3 个 archetype(list/config/dashboard)据此渲染真实页。
 * 目标:把 64 个脚手架模块用"archetype + 内容数据"变成四镜头合规的真实页,而非手写每页。
 * 内容均为 mock,但结构 backend-replaceable(可序列化、字段化)。
 */
export type Archetype = "list" | "config" | "dashboard";

export interface Metric {
  label: string;
  value: string;
  sub?: string;
  accent?: string; // var(--...)
  hint?: string;
  delta?: { dir: "up" | "down"; text: string; good?: boolean };
}

export interface Col {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  mono?: boolean;
  status?: boolean; // 渲染为状态 pill(按关键词着色)
}

export interface ListSpec {
  kind: "list";
  metrics?: Metric[];
  search?: string; // placeholder
  filters?: string[]; // chip 标签,首项约定为"全部"
  filterKey?: string; // 用哪一列做 chip 过滤
  columns: Col[];
  rows: Record<string, string>[];
  rowIdKey?: string; // 行唯一键列(默认 columns[0].key;非唯一首列时显式指定避免重复 React key)
  detail?: boolean; // 行可点开右侧抽屉看全字段
  primaryAction?: { label: string; fields?: string[] }; // 主操作入口(如"新增 SKU"):右上按钮 → 创建抽屉(表单字段)
  rowActions?: { label: string; tone?: "primary" | "danger"; whenStatus?: string }[]; // 行级操作(详情抽屉内):冻结/停用/下发/补件…whenStatus 按状态门控
  note?: string; // Maker-Checker / 口径脚注
}

export interface ConfigField {
  label: string;
  value: string;
  range?: string;
  effect?: string;
}
export interface ConfigSpec {
  kind: "config";
  metrics?: Metric[];
  groups: { title: string; note?: string; fields: ConfigField[] }[];
  approval: string; // Maker-Checker 说明
  impact?: string[]; // 下游联动
}

export interface ChartSpec {
  type: "area" | "bars" | "donut";
  title: string;
  sub?: string;
  color?: string;
  data?: number[]; // area / bars
  labels?: string[]; // bars x 轴标签
  refLine?: number; // area 参照线
  segments?: { label: string; value: number; color: string }[]; // donut
  unit?: string;
}
export interface DashboardSpec {
  kind: "dashboard";
  metrics?: Metric[];
  charts?: ChartSpec[];
  controlLink?: { label: string; href: string }; // 调整入口 → 跳关联 config 模块(dashboard 本身只读分析)
  note?: string;
}

export type ModuleContent = ListSpec | ConfigSpec | DashboardSpec;

export interface ModuleEntry {
  path: string; // 与 console-nav 的 L2 path 对齐
  summary: string; // 页头一句话说明(口径/数据源)
  content: ModuleContent;
}
