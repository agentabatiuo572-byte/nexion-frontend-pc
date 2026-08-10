import { g4Request } from "./g4-client";
import { createStableMutationExecutor, stableMutationFingerprint } from "./stable-mutation";

export type G4InviteStatus = "unused" | "used" | "void";
export interface G4InviteCode {
  code: string; status: G4InviteStatus; issuedBy: string; issuedAt: number; note: string;
  redeemedBy: string | null; redeemedAt: number | null; voidedBy: string | null;
  voidedAt: number | null; voidReason: string | null;
}
export interface G4InviteRegistry { codes: G4InviteCode[]; counts: Record<G4InviteStatus | "all", number>; }
export const G4_INVITE_STATUS_LABEL: Record<G4InviteStatus,string> = { unused: "未使用", used: "已使用", void: "已作废" };
export const G4_INVITE_STATUS_TONE: Record<G4InviteStatus,string> = { unused: "ok", used: "dim", void: "bad" };
export const G4_INVITE_MAX_BATCH = 100;
export const G4_INVITE_NOTE_MAX = 60;
export const G4_INVITE_REASON_MIN = 8;
export const G4_INVITE_REASON_MAX = 200;

let seq = 0;
const nextG4InviteCommandKey = (prefix: string) => `${prefix}-${Date.now()}-${++seq}`;
const execute = createStableMutationExecutor(nextG4InviteCommandKey, "nexion-admin-g4-invite-commands-v2");
const record = (value: unknown, field: string): Record<string,unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`G4_INVITE_RESPONSE_INVALID:${field}`);
  return value as Record<string,unknown>;
};
const text = (value: unknown, field: string, nullable = false): string | null => {
  if (value === null && nullable) return null;
  if (typeof value !== "string") throw new Error(`G4_INVITE_RESPONSE_INVALID:${field}`);
  return value;
};
const time = (value: unknown, field: string, nullable = false): number | null => {
  if (value === null && nullable) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new Error(`G4_INVITE_RESPONSE_INVALID:${field}`);
  return parsed;
};
function normalizeCode(value: unknown): G4InviteCode {
  const row = record(value, "code");
  if (!(["unused","used","void"] as unknown[]).includes(row.status)) throw new Error("G4_INVITE_RESPONSE_INVALID:status");
  const status = row.status as G4InviteStatus;
  return {
    code: text(row.code,"code")!, status, issuedBy: text(row.issuedBy,"issuedBy")!, issuedAt: time(row.issuedAt,"issuedAt")!,
    note: text(row.note,"note")!, redeemedBy: text(row.redeemedBy,"redeemedBy",true), redeemedAt: time(row.redeemedAt,"redeemedAt",true),
    voidedBy: text(row.voidedBy,"voidedBy",true), voidedAt: time(row.voidedAt,"voidedAt",true), voidReason: text(row.voidReason,"voidReason",true),
  };
}
function normalizeRegistry(value: unknown): G4InviteRegistry {
  const row=record(value,"registry");
  if(!Array.isArray(row.codes))throw new Error("G4_INVITE_RESPONSE_INVALID:codes");
  const counts=record(row.counts,"counts");
  const count=(key:string)=>{const v=counts[key];if(typeof v!=="number"||!Number.isInteger(v)||v<0)throw new Error(`G4_INVITE_RESPONSE_INVALID:counts.${key}`);return v;};
  return {codes:row.codes.map(normalizeCode),counts:{all:count("all"),unused:count("unused"),used:count("used"),void:count("void")}};
}
export async function fetchG4InviteCodes(){return normalizeRegistry(await g4Request("/nex/genesis/invite-codes"));}
export async function issueG4InviteCodes(count:number,note:string,operator:string){
  if(!Number.isInteger(count)||count<1||count>G4_INVITE_MAX_BATCH)throw new Error(`单次生成数量需为 1-${G4_INVITE_MAX_BATCH} 的整数`);
  if(note.trim().length>G4_INVITE_NOTE_MAX)throw new Error(`发放备注不能超过 ${G4_INVITE_NOTE_MAX} 字`);
  const body=JSON.stringify({count,note:note.trim(),operator});const path="/nex/genesis/invite-codes";
  return execute("g4-invite-issue",stableMutationFingerprint("POST",path,body),async(key)=>{
    const raw=record(await g4Request(path,{method:"POST",headers:{"Idempotency-Key":key},body}),"issue");
    const registry=normalizeRegistry(raw.registry);if(!Array.isArray(raw.issued))throw new Error("G4_INVITE_RESPONSE_INVALID:issued");
    const issuedCodes=new Set(raw.issued.map((item)=>String(record(item,"issued").code??"")));
    return {issued:registry.codes.filter((item)=>issuedCodes.has(item.code)),registry};
  },(value)=>value);
}
export async function voidG4InviteCode(code:string,reason:string,operator:string){
  const trimmed=reason.trim();if(trimmed.length<G4_INVITE_REASON_MIN||trimmed.length>G4_INVITE_REASON_MAX)throw new Error(`作废理由需 ${G4_INVITE_REASON_MIN}-${G4_INVITE_REASON_MAX} 字`);
  const path=`/nex/genesis/invite-codes/${encodeURIComponent(code)}/void`;const body=JSON.stringify({reason:trimmed,operator});
  return execute(`g4-invite-void-${code}`,stableMutationFingerprint("POST",path,body),async(key)=>{
    const registry=normalizeRegistry(await g4Request(path,{method:"POST",headers:{"Idempotency-Key":key},body}));
    const changed=registry.codes.find((item)=>item.code===code);if(!changed)throw new Error("G4_INVITE_RESPONSE_INVALID:voided-code");return {code:changed,registry};
  },(value)=>value);
}
