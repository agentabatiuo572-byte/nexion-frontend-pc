import ConsoleLayout from "@/app/_console/layout";
import A6RolesPage from "@/app/_console/platform/roles/page";

export const dynamic = "force-dynamic";

/** A6 角色管理服务路由（ConsoleLayout 包裹,非 A5 裸页坑）。 */
export default function Page() {
  return (
    <ConsoleLayout>
      <A6RolesPage />
    </ConsoleLayout>
  );
}
