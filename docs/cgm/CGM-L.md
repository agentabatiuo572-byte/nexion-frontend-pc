# CGM-L · 数据BI(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 2 行。

| id | scope | type | frontendField | opsPurpose | crudActions | MC | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-L-001 | platform | data-CRUD | global.activeDevices / global.paidToday / globa… | platform_integrity,content_compliance | 运营只读真实聚合值;不可客户端 random 造数。生产由服务端流广播,客户端仅镜像最新快照。 | Y | 读 SSE/WebSocket GET /api/platform/stats (per PRD … | gap |
| CGM-L-002 | platform | param-config | global.nodes / global.countries / global.uptime | platform_integrity,content_compliance | 运营核定并调整对外展示值(目标态=真实/合规口径);生产由服务端 platform stats 提供。 | Y | 读 SSE /api/platform/stats (per PRD §9.11c.1);写 TB… | gap |
