import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * shadcn/ui 标准类名合并工具:clsx 处理条件类 + tailwind-merge 去重冲突的 Tailwind 类。
 * 引入 shadcn 组件(app/components/ui/*)的脚手架依赖。
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
