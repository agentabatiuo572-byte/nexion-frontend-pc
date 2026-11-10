/**
 * E 批小图形件的样例页，只在开发时用：/rd-gallery。不进菜单，生产构建里是 404。
 * 页面开发完成后整个 app/rd-gallery 目录删除，别处没有引用它。
 */
import { notFound } from "next/navigation";
import ConsoleLayout from "@/app/_console/layout";
import { Gallery } from "./gallery";

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <ConsoleLayout>
      <Gallery />
    </ConsoleLayout>
  );
}
