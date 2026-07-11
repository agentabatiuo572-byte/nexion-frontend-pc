import ConsoleLayout from "@/app/_console/layout";
import A7MenusPage from "@/app/_console/platform/menus/page";

export const dynamic = "force-dynamic";

/** A7 菜单管理服务路由（ConsoleLayout 包裹，非 A5 裸页坑）。 */
export default function Page() {
  return (
    <ConsoleLayout>
      <A7MenusPage />
    </ConsoleLayout>
  );
}
