/**
 * TaskClassTag 任务类型标签。六类任务各一个固定图标，中文全名常显；名称和顺序取 lib/admin/task-classes.ts，页面不自己配图标和颜色。
 *
 * <TaskClassTag taskClass="LL" />   →   图标 + 大模型推理
 *
 * - 类型不是状态：不用启用、停用那套状态色，字是正文色，只有图标带色。
 * - 六类只用两个角色色：向量计算、语音处理是青，图像生成、大模型推理、模型微调、视频生成是紫；靠图标和名字分清是哪一类，不画六种颜色。
 * - 表格的类型列、设备的当前任务、类型筛选片都用它。筛选片外面由页面包 Check 或按钮。标签没有自己的读取态，跟着所在的行。
 */
import { AudioLines, Bot, Image, Network, SlidersHorizontal, Video, type LucideIcon } from "lucide-react";
import { TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import type { RoleTone } from "./tone";

export type TaskClass = keyof typeof TASK_CLASS_LABELS;

const LOOK: Record<TaskClass, { icon: LucideIcon; tone: RoleTone }> = {
  EM: { icon: Network, tone: "role-2" },
  SP: { icon: AudioLines, tone: "role-2" },
  IG: { icon: Image, tone: "role-3" },
  LL: { icon: Bot, tone: "role-3" },
  FT: { icon: SlidersHorizontal, tone: "role-3" },
  VG: { icon: Video, tone: "role-3" },
};

export function TaskClassTag({ taskClass }: { taskClass: TaskClass }) {
  const { icon: Icon, tone } = LOOK[taskClass];
  return (
    <span className="rd-classtag" data-tone={tone}>
      <Icon size={14} strokeWidth={1.9} aria-hidden />
      {TASK_CLASS_LABELS[taskClass]}
    </span>
  );
}
