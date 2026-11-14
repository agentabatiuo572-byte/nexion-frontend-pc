/** Compare the conversion from the previous step; ties keep the earlier step. */
export function lowestConversionIndex(rates: readonly (number | null | undefined)[]): number | null {
  return rates.reduce<number | null>((lowest, rate, index) => {
    if (index === 0 || rate == null) return lowest;
    return lowest === null || rate < rates[lowest]! ? index : lowest;
  }, null);
}
