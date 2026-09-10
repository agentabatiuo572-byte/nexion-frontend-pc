/**
 * A failed M3 initial read still leaves a fail-closed M-domain snapshot in
 * memory.  That snapshot is sufficient to run the read-only realtime
 * recovery channel; it is not sufficient to enable any conversation write.
 */
export function shouldStartM3ConversationRecovery(input: {
  hasM3ReadAuthority: boolean;
  hasMContentSnapshot: boolean;
  isMContentLoading: boolean;
}): boolean {
  return input.hasM3ReadAuthority && input.hasMContentSnapshot && !input.isMContentLoading;
}
