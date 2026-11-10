import { Btn, Badge, DataListPager } from "../design-kit";
import type { E5Device } from "@/lib/admin/e5-client";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { TASK_CLASS_LABELS } from "@/lib/admin/task-classes";
import { RdPage } from "@/app/components/rd";
import type { EViewCtx } from "./types";
import { OpsHint } from "./ops-hint";
import { E5DevicePage } from "./e5-device-page";
import { E5CommandScope, E5DeviceActions } from "./e5-device-actions";

const PHONE_STATES: Record<E5Device["state"], string> = { active: "在线", busy: "任务中", offline: "离线", inventory: "待激活", "pending-deactivate": "停用中", unbound: "已解绑 / 停用", abnormal: "异常", unknown: "状态未知" };

export function E5Ops({ ctx, phones = false }: { ctx: EViewCtx; phones?: boolean }) {
  if (!phones) return <E5DevicePage ctx={ctx} />;
  // Preserve the E6 list layout; only its shared action/recovery flow changes here.
  return <RdPage><E5CommandScope refresh={ctx.refreshE5} toast={ctx.toast}>
    <section className="pane" data-proof="e6-phone-devices">
      <div className="pane-h"><span className="ttl">用户手机</span><OpsHint>操作权限与设备管理一致；每人 6 台上限包含手机。</OpsHint></div>
      <div className="tp-toolbar">
        <input className="fld e5-phone-search" value={ctx.e5Keyword} onChange={event => ctx.setE5Keyword(event.target.value)} placeholder="搜索用户 / 手机" aria-label="搜索用户手机" />
        <Btn sm disabled={ctx.e5Loading} onClick={() => void ctx.refreshE5()}>刷新</Btn>
      </div>
      {ctx.e5DeviceError && <div className="tint danger" role="alert">{ctx.e5DeviceError}</div>}
      <div className="tp-table-wrap"><table className="tp-table"><thead><tr><th>设备</th><th>用户</th><th>手机状态</th><th>状态</th><th>每日收益</th><th>当前任务</th><th>操作</th></tr></thead>
        <tbody>{ctx.e5Loading ? <tr><td colSpan={7} className="empty">正在加载…</td></tr> : ctx.e5DeviceError ? <tr><td colSpan={7} className="empty">设备读取失败，请刷新重试</td></tr> : !ctx.e5Devices.length ? <tr><td colSpan={7} className="empty">暂无符合条件的手机</td></tr> : ctx.e5Devices.map(d => <tr key={d.deviceId}>
          <td><strong>{d.deviceName}</strong><small>{d.serial}</small></td><td><strong>{d.nickname}</strong><small>{d.userNo}</small></td>
          <td><div className="row"><span>{d.batteryLevel == null ? "—" : `${d.batteryLevel}%`}</span><OpsHint>心跳：{d.heartbeatAt}<br />{d.isCharging ? "充电中" : "未充电"} · {d.isWifiConnected ? "网络可达" : "网络断开"}<br />温控：{d.thermalState}</OpsHint></div></td>
          <td><Badge tone="neutral">{d.pausedReason ? "已暂停" : PHONE_STATES[d.state]}</Badge></td><td>{d.dailyUsdt ?? "—"} USDT</td>
          <td>{d.currentTask ? <><strong>{TASK_CLASS_LABELS[d.currentTask.taskClass as keyof typeof TASK_CLASS_LABELS] ?? d.currentTask.taskClass}</strong><small>{Math.max(0, Math.ceil((Date.parse(d.currentTask.dueAt) - Date.parse(d.currentTask.startedAt)) / 60000))} 分钟 <OpsHint>{d.currentTask.name}<br />任务号：{d.currentTask.taskNo}<br />开始：{formatBusinessTimeCompact(d.currentTask.startedAt)}<br />预计完成：{formatBusinessTimeCompact(d.currentTask.dueAt)}</OpsHint></small></> : d.activeTaskNo !== "—" ? d.activeTaskNo : "—"}</td>
          <td><E5DeviceActions device={d} ctx={ctx} phones /></td></tr>)}</tbody></table></div>
      <DataListPager label="用户手机" total={ctx.e5Total} page={ctx.e5Page} pageSize={ctx.e5PageSize} onPageChange={ctx.setE5Page} onPageSizeChange={ctx.setE5PageSize} pageSizeOptions={[10, 20, 50]} />
    </section>
  </E5CommandScope></RdPage>;
}
