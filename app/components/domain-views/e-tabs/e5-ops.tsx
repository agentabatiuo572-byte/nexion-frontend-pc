import type { EViewCtx } from "./types";
import { E5DevicePage } from "./e5-device-page";
import { E6PhoneDevices } from "./e6-phone-devices";

export function E5Ops({ ctx, phones = false }: { ctx: EViewCtx; phones?: boolean }) {
  return phones ? <E6PhoneDevices ctx={ctx} /> : <E5DevicePage ctx={ctx} />;
}
