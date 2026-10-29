import ConsoleLayout from "@/app/_console/layout";
import { DomainModuleBoundary } from "@/app/components/domain-views/domain-module-state";
import { M6Leaderboard } from "@/app/components/domain-views/m-tabs/m6-leaderboard";

export default function Page() {
  return (
    <ConsoleLayout>
      <DomainModuleBoundary>
        <M6Leaderboard />
      </DomainModuleBoundary>
    </ConsoleLayout>
  );
}
