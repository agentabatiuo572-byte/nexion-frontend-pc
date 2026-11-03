export const TASK_CLASS_LABELS = {
  EM: "向量计算", SP: "语音处理", IG: "图像生成",
  LL: "大模型推理", FT: "模型微调", VG: "视频生成",
} as const;

export const TASK_CLASSES = Object.keys(TASK_CLASS_LABELS) as (keyof typeof TASK_CLASS_LABELS)[];

export function taskClassNames(classes: readonly string[] = []) {
  return TASK_CLASSES.filter((key) => classes.includes(key)).map((key) => TASK_CLASS_LABELS[key]).join("、") || "未选择";
}
