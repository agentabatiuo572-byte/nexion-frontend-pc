/** Same user-code projection as M3 and the support profile; routes keep the numeric customerId. */
export const m1CustomerCode = (customerId: string) => `U${customerId.padStart(8, "0")}`;
