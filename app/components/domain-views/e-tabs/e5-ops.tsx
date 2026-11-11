import type { EViewCtx } from "./types";
import { E5DevicePage } from "./e5-device-page";

export function E5Ops({ ctx }: { ctx: EViewCtx }) {
  return <E5DevicePage ctx={ctx} />;
}
