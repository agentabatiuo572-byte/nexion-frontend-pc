export interface E5DeviceIdentity {
  id: string;
  serial: string;
  deviceName: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// The fallback key is only for React/client identity. It must never be sent to
// the operator display as a server-issued device number or device name.
export function parseE5DeviceIdentity(instanceNo: unknown, name: unknown, deviceId: number): E5DeviceIdentity {
  const serial = text(instanceNo);
  return {
    id: serial || (deviceId > 0 ? `device-${deviceId}` : "unknown-device"),
    serial,
    deviceName: text(name),
  };
}
