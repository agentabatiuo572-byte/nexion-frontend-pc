import ConsoleLayout from "@/app/_console/layout";
import A8PermissionsPage from "@/app/_console/platform/permissions/page";

export const dynamic = "force-dynamic";

/** A8 权限字典服务路由（照 app/[domain]/[module]/page.tsx 活形态，ConsoleLayout 包裹，非 A5 裸页坑）。 */
export default function Page() {
  return (
    <ConsoleLayout>
      <A8PermissionsPage />
    </ConsoleLayout>
  );
}
