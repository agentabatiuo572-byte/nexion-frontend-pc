import type { L4LiveFact } from "./l4-live-data";

const GROUPS: ReadonlyArray<{ key: L4LiveFact["group"]; title: string; subtitle: string; missing: string }> = [
  {
    key: "device",
    title: "设备数据",
    subtitle: "设备目录、订单和用户设备的当前情况",
    missing: "暂无设备数据。",
  },
  {
    key: "task",
    title: "任务数据",
    subtitle: "算力任务和任务目录的当前情况",
    missing: "暂无任务数据。",
  },
  {
    key: "network",
    title: "团队数据",
    subtitle: "团队关系和佣金的当前情况",
    missing: "暂无团队和佣金数据。",
  },
  {
    key: "phase",
    title: "运营阶段数据",
    subtitle: "仅显示已启用配置，不等同于效果分析",
    missing: "暂无运营阶段数据。",
  },
  {
    key: "tradein",
    title: "升级置换数据",
    subtitle: "设置修改、换新申请和完成情况",
    missing: "暂无升级置换数据。",
  },
];

export function L4LiveFacts({ facts }: { facts: L4LiveFact[] }) {
  return (
    <div>
      <div className="ltint warn" style={{ marginBottom: 12, fontSize: 12 }}>
        <b>目前只能看当前数据</b> · 还没有按日、周、月的历史数据，所以暂时不能按周期或阶段筛选，也不会估算环比、承接率等指标。
      </div>

      <div className="two-col">
        {GROUPS.map((group) => {
          const rows = facts.filter((fact) => fact.group === group.key);
          return (
            <section className="l-card" key={group.key}>
              <div className="l-h">
                <span className="ttl">{group.title}</span>
                <span className="sub">· {group.subtitle}</span>
                <div className="r"><span className="lcode electric">当前数据</span></div>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table className="l-tbl" style={{ minWidth: 620 }}>
                  <thead><tr><th>指标</th><th className="num">当前值</th><th>业务含义</th><th>数据源</th></tr></thead>
                  <tbody>
                    {rows.map((fact) => (
                      <tr key={fact.key}>
                        <td style={{ fontWeight: 600, color: "var(--ink)" }}>{fact.label}</td>
                        <td className="num mono" style={{ color: "var(--cyan)" }}>{fact.value.toLocaleString("zh-CN")}</td>
                        <td>{fact.description}</td>
                        <td><span className="lcode">{fact.sourceLabel}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length === 0 && <div className="ltint" style={{ margin: 12 }}>{group.missing}</div>}
              </div>
            </section>
          );
        })}
      </div>

      <section className="l-card">
        <div className="l-b">
          <div className="ltint warn" style={{ fontSize: 12 }}>
            <b>跨模块历史分析待统一接入</b> · 设备机型与产出衰减、六类任务承接与饱和度、团队层级分布与团队成交额、阶段留存与转化效果，都需要各业务域提供同统计规则历史序列。当前页面明确降级，不使用目录数量替代活跃量，也不使用累计记录拼接周期趋势。
          </div>
          <div className="ltint" style={{ fontSize: 12, marginTop: 10 }}>
            <b>导出范围</b> · 「运营汇总」只包含本页数据。团队关系明细暂时不能导出。
          </div>
        </div>
      </section>

      <p className="f-foot"><b>这页只能查看</b>：显示的都是当前数据；还没接入的历史统计会明确标出。</p>
    </div>
  );
}
