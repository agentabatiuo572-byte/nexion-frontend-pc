import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
export const root = path.resolve(import.meta.dirname, ".."), fe = process.env.GROUP_FE_ROOT || root;
const require = createRequire(path.join(fe, "package.json")), ts = require("typescript");
export const actualSupport = await import(pathToFileURL(path.join(fe, "lib/admin/m-support-client.ts")).href);
export function load(file, dependencies = {}, globals = {}, actual = false) {
  const source = fs.readFileSync(path.join(actual ? fe : root, file), "utf8"), code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in dependencies ? dependencies[name] : require(name), URL, URLSearchParams, AbortController, Date, crypto: { randomUUID: () => "12345678-1234-1234-1234-123456789012" }, console: { warn() {}, error: console.error }, ...globals });
  return module.exports;
}
export function storage() { const records = new Map(); return { quota: false, records, get length() { return records.size; }, key(i) { return [...records.keys()][i] ?? null; }, getItem(k) { return records.get(k) ?? null; }, setItem(k,v) { if (this.quota) throw new Error("QuotaExceededError"); records.set(k,v); }, removeItem(k) { records.delete(k); } }; }
export function makeClient(transport = {}, persisted = storage(), clock = Date) {
  const pending = load("lib/admin/pending-mutation-store.ts", {}, { window: { sessionStorage: persisted }, Date: clock }, true);
  return load("lib/admin/support-group-client.ts", { "./m-support-client.ts": { ...actualSupport, ...transport }, "./pending-mutation-store.ts": pending }, { Date: clock });
}
export const why = "按已确认安排调整";
export const group = (id = "5", owner = "17", version = 3) => ({ id, name: "第一组" + id, supervisorAdminId: owner, status: "ENABLED", version });
export const detail = (id = "5", members = [], owner = "17") => ({ group: group(id, owner), members, memberCount: members.length, routedCustomers: 0, pendingOperations: 0, blockers: { members: members.length, routedCustomers: 0, pendingOperations: 0, canExit: !members.length, nextSteps: [] } });
export const member = (adminId = "21", groupId = "5", state = "AVAILABLE") => ({ adminId, name: "专属客服" + adminId, accountStatus: 1, currentMember: { state, id: state === "AVAILABLE" ? "88" : null, groupId: state === "AVAILABLE" ? groupId : null, version: state === "AVAILABLE" ? 7 : null }, boundCustomers: 4 });
export const qualification = (adminId = "21", state = "ABSENT", accountVersion = "13") => ({ adminId, name: "待配置账号" + adminId, accountStatus: 1, accountVersion, qualifications: ["SERVICE", "SUPERVISOR"].map(kind => ({ kind, state: state === "AVAILABLE" ? "ENABLED" : null, observationState: state, id: state === "AVAILABLE" ? (kind === "SERVICE" ? "1" : "2") : null, version: state === "AVAILABLE" ? 8 : null })) });
export const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
export const tick = () => new Promise(resolve => setImmediate(resolve));
export function find(tree, predicate) { if (!tree || typeof tree !== "object") return; if (predicate(tree)) return tree; for (const child of [tree.props?.children, tree.props?.footer].flat(Infinity)) { const found = find(child, predicate); if (found) return found; } }
export function text(tree) { if (tree == null || typeof tree === "boolean") return ""; if (typeof tree !== "object") return String(tree); if (Array.isArray(tree)) return tree.map(text).join(" "); return text(tree.props?.children) + " " + text(tree.props?.footer); }
export function all(tree, predicate, found = []) { if (!tree || typeof tree !== "object") return found; if (predicate(tree)) found.push(tree); for (const child of [tree.props?.children, tree.props?.footer].flat(Infinity)) all(child,predicate,found); return found; }
const Btn = () => null, Modal = () => null, HDSelect = () => null;
// Executes the real container's hooks/effects/events with controlled promises; not React DOM/browser acceptance.
export function harness(options = {}) {
  const cells = [], effects = []; let cursor = 0, dirty = true, tree;
  let auth = options.auth || { isAuthenticated: true, authEpoch: 1, logoutPending: false, logoutUnknown: false, session: { adminId: 17, role: "SUPER_ADMIN", operator: "主管甲", authorities: ["service_m1_read", "service_m1_write", "platform_a1_read", "platform_a1_write"], menuCodes: ["M1", "A1"] } };
  const hooks = { useState(initial) { const i=cursor++; if (!(i in cells)) cells[i]=typeof initial === "function" ? initial() : initial; return [cells[i], next => { const n=typeof next === "function" ? next(cells[i]) : next; if (!Object.is(n,cells[i])) { cells[i]=n; dirty=true; } }]; }, useRef(initial) { const i=cursor++; return cells[i] ||= { current: initial }; }, useEffect(run,deps) { const i=cursor++, old=cells[i]; if (!old || deps.some((d,j)=>!Object.is(d,old.deps[j]))) effects.push(()=>{ old?.cleanup?.(); cells[i]={deps,cleanup:run()}; }); } };
  const useAdminAuth = selector => selector(auth); useAdminAuth.getState = () => auth;
  const calls = [], persisted = options.storage || storage(), clientModule = makeClient({}, persisted, options.clock || Date), implementations = options.implementations || {};
  const defaultValue = { groups: () => [], detail: id => detail(id), member: id => member(id), qualifications: id => qualification(id), supervisors: () => ({items:[],supervisorCount:0,memberCount:0,peopleCount:0}), candidates: q => ({records:[],total:0,pageNum:q.pageNum,pageSize:q.pageSize}), command: () => ({status:"UNKNOWN"}) };
  const client = new Proxy({}, { get: (_,name) => (...args) => { calls.push({ name, args, stored: clientModule.groupPendingCommands.list().map(r=>structuredClone(r)) }); return Promise.resolve().then(()=> (implementations[name] || defaultValue[name] || (()=>{throw new Error("unscripted write");}))(...args)); } });
  const nav = load("lib/nav/console-nav.ts", { "lucide-react": new Proxy({}, {get:()=>()=>null}) }, {}, true), outcomes=load("lib/admin/outcome-classification.ts", {}, {}, true);
  const exports = load("app/components/domain-views/m-tabs/m1-group-management.tsx", { react: hooks, "@/lib/store/admin-auth": {useAdminAuth}, "@/lib/admin/shell-authorities": {adminShellSessionKey:(s,e)=>`${e}|${s?.adminId}|${[...(s?.authorities??[])].sort()}|${[...(s?.menuCodes??[])].sort()}`}, "@/lib/nav/console-nav": nav, "@/lib/admin/outcome-classification": outcomes, "@/lib/admin/m-support-client": actualSupport, "@/lib/admin/support-group-client": {...clientModule,supportGroupClient:client}, "../design-kit": {Btn,Modal}, "./hd-ui": {HDSelect}, "./m-support-admin.css": {}, "./m1-group-management.css": {} });
  const props = options.qualification ? {adminId:"21",kind:"SERVICE",onClose(){},onChanged(){changes++;},...options.props} : {mode:"MANAGED",onBack(){backs++;},onChanged(){changes++;},...options.props}; let changes=0,backs=0;
  const component=options.qualification ? exports.SupportQualificationEditor : exports.M1GroupManagement;
  function commit(beforeEffects=false) { let n=0; do { dirty=false; cursor=0; effects.length=0; tree=component(props); if (beforeEffects) return tree; for (const effect of effects) effect(); if (++n>25) throw new Error("hook loop"); } while(dirty); return tree; }
  const h={calls,persisted,store:clientModule.groupPendingCommands,exports,props,commit,async flush(){for(let i=0;i<4;i++){await tick();commit();}},button(label){const result=find(tree,n=>n.type===Btn&&text(n.props.children)===label); if(!result) throw new Error(`button missing ${label}: ${text(tree)}`); return result;},click(label){const b=this.button(label); if(b.props.disabled) throw new Error(`button disabled: ${label}`); b.props.onClick();commit();},modal:()=>find(tree,n=>n.type===Modal),selects:()=>all(tree,n=>n.type===HDSelect),input(value){find(tree,n=>n.type==="input").props.onChange({target:{value}});commit();},reason(value=why){find(tree,n=>n.type==="textarea").props.onChange({target:{value}});commit();},changeAuth(next,preEffects=false){auth={...auth,...next};return commit(preEffects);},unmount(){for(const cell of cells) cell?.cleanup?.();},get auth(){return auth;},get tree(){return tree;},get changes(){return changes;},get backs(){return backs;}};
  commit(); return h;
}
