import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { isM4FaqCommand, type M4FaqCommand } from "./m4-faq-command";
import { isM5Command, type M5Command } from "./m5-command";

export interface MCommandRecord extends PendingMutationRecord {
  /** 本次提交的值:带 commandKey 的调用点靠它保证重试提交的仍是同一个值。 */
  value?: string;
  /** 参数指纹(`参数键\0值\0理由`)。同一参数换了逻辑命令 id 时,靠它回收上一次的命令号。 */
  paramFingerprint?: string;
  clientMessageId?: string;
  /** The exact normalized reason of a pending M3 end command survives refresh. */
  closeReason?: string;
  faq?: M4FaqCommand;
  m5?: M5Command;
}
export const mCommands = createPendingMutationStore<MCommandRecord>({
  storageKey: "nexion-admin-m-content-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: (record) => (record.value === undefined || typeof record.value === "string")
    && (record.paramFingerprint === undefined || typeof record.paramFingerprint === "string")
    && (record.clientMessageId === undefined || typeof record.clientMessageId === "string")
    && (record.closeReason === undefined || typeof record.closeReason === "string")
    && (record.faq === undefined || isM4FaqCommand(record.faq))
    && (record.m5 === undefined || isM5Command(record.m5)),
});
