/** Mirrors OpsDeviceService.e3ConfigAmplifies for the editable E3 policy. */
export function e3ConfigAmplifies(before: Record<string, string>, changes: Record<string, string>): boolean {
  const keys = Object.keys(changes).filter((key) => changes[key] !== before[key]);
  if (!keys.length || keys.some((key) => !changes[key].trim())) return false;
  const after = { ...before, ...changes };
  const higher = ["E.device.capacity.band1DeltaPct", "E.device.capacity.band2DeltaPct", "E.device.capacity.band3DeltaPct", "E.device.capacity.floorPct", "E.tradein.maxDevicesPerOrder"];
  if (keys.some((key) => higher.includes(key) && Number(after[key]) > Number(before[key]))) return true;
  if (keys.includes("E.tradein.enabled") && before["E.tradein.enabled"] !== "开" && after["E.tradein.enabled"] === "开") return true;
  if (keys.includes("E.tradein.requireHigherPrice") && before["E.tradein.requireHigherPrice"] === "开" && after["E.tradein.requireHigherPrice"] === "关") return true;
  if (keys.includes("E.tradein.eligibility")) {
    const rank = (value: string) => Number(value.match(/^L([2-6])\+/)?.[1] ?? 0);
    if (rank(after["E.tradein.eligibility"]) < rank(before["E.tradein.eligibility"])) return true;
  }
  const stageKeys = ["E.device.stageEarlyEnd", "E.device.stageMidEnd"];
  const participationKeys = Object.keys(before).filter((key) => key.startsWith("E.device.capacity.applyTo."));
  const curveChanged = keys.some((key) => stageKeys.includes(key) || key.startsWith("E.device.capacity.band") || key === "E.device.capacity.floorPct" || participationKeys.includes(key));
  if (curveChanged) {
    const probes = new Set([1]);
    for (const policy of [before, after]) for (const key of stageKeys) {
      const boundary = Number(policy[key]);
      for (const month of [boundary - 1, boundary, boundary + 1]) if (month > 0) probes.add(month);
    }
    const last = Math.max(...probes);
    probes.add(last + 12); probes.add(last + 120);
    const capacity = (policy: Record<string, string>, month: number) => {
      const early = Number(policy[stageKeys[0]]), mid = Number(policy[stageKeys[1]]);
      const factor = (band: number) => 1 + Number(policy[`E.device.capacity.band${band}DeltaPct`]) / 100;
      return Math.round(Math.max(Number(policy["E.device.capacity.floorPct"]), 100
        * factor(1) ** Math.min(month, early)
        * factor(2) ** Math.max(Math.min(month, mid) - early, 0)
        * factor(3) ** Math.max(month - mid, 0)) * 1e6) / 1e6;
    };
    for (const month of probes) {
      const oldCapacity = capacity(before, month), newCapacity = capacity(after, month);
      if (keys.some((key) => stageKeys.includes(key)) && newCapacity > oldCapacity) return true;
      if (participationKeys.some((key) => (after[key] === "参与递减" ? newCapacity : 100)
        > (before[key] === "参与递减" ? oldCapacity : 100))) return true;
    }
  }
  if (keys.some((key) => key.startsWith("E.tradein.ladder."))) {
    const boundaries = new Set([0, 101]);
    for (const policy of [before, after]) for (let i = 1; i <= 4; i++) boundaries.add(Number(policy[`E.tradein.ladder.cut${i}`]));
    const ordered = [...boundaries].sort((a, b) => a - b);
    const probes = [...ordered, ...ordered.slice(1).map((value, index) => (ordered[index] + value) / 2)];
    const credit = (policy: Record<string, string>, ratio: number) => {
      for (let i = 1; i <= 4; i++) if (ratio < Number(policy[`E.tradein.ladder.cut${i}`])) return Number(policy[`E.tradein.ladder.credit${i}`]);
      return Number(policy["E.tradein.ladder.credit5"]);
    };
    if (probes.some((ratio) => credit(after, ratio) > credit(before, ratio))) return true;
  }
  return false;
}
