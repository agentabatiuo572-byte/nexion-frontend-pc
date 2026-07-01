import ConsoleLayout from "@/app/_console/layout";
import CatchAllScaffold from "@/app/_console/[domain]/[module]/page";

type Props = Parameters<typeof CatchAllScaffold>[0];

export default function Page(props: Props) {
  return (
    <ConsoleLayout>
      <CatchAllScaffold {...props} />
    </ConsoleLayout>
  );
}
