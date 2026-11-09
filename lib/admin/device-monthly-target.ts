/** Every non-phone store product with DEVICE pools needs a monthly target. */
export function supportsDeviceMonthlyTarget(skuId: string, tier = ""): boolean {
  return !/phone|mobile/i.test(`${skuId} ${tier}`);
}
