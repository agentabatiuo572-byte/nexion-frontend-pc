/** A rejected direct write is not consent to create an approval request.
 * The view must show its existing approval confirmation, retaining input/reason,
 * and call confirm only after the operator confirms that approval mode.
 */
export class HApprovalRequired extends Error {
  constructor(message: string, public readonly input: object, public readonly confirm: () => Promise<unknown>) {
    super(message);
    this.name = "HApprovalRequired";
  }
}
