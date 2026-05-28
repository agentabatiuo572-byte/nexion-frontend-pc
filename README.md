# Nexion Admin Web

PC 管理端，参考 `macrozheng/mall-admin-web` 的 Vue3 + Element Plus 后台管理结构实现。

## 技术栈

- Vue 3
- Vite
- Vue Router
- Pinia
- Element Plus
- Axios

## 启动

```powershell
& 'D:\software\nodejs\npm.cmd' install
& 'D:\software\nodejs\npm.cmd' run dev -- --port 5173
```

如果 npm 默认缓存目录权限异常，可以使用项目内缓存：

```powershell
& 'D:\software\nodejs\npm.cmd' install --cache D:\workspace\nexion-frontend-pc\.npm-cache
```

## 环境变量

复制 `.env.example` 为 `.env.local`，按实际网关地址调整：

```env
VITE_BASE_SERVER_URL=/api
```

开发环境默认通过 Vite proxy 统一联调 Gateway：

| 前端路径 | 后端服务 |
|---|---|
| `/api/**` | `http://127.0.0.1:8090` |

## 联调检查

本地联调前需要确保 Gateway 和对应后端服务已启动：

- `nexion-gateway`: `8090`
- `nexion-auth-service`: `8101`
- `nexion-compute-service`: `8102`
- `nexion-commerce-service`: `8104`
- `nexion-wallet-service`: `8105`
- `nexion-team-service`: `8106`
- `nexion-compliance-service`: `8109`
- `nexion-system-service`: `8110`
- `nexion-openapi-service`: `8111`
- `nexion-bff-service`: `8100`

当前 PC 管理端对齐的主要接口：

- `/api/commerce/products|orders|payments|tradeins`
- `/api/genesis/series|orders|holdings|overview`
- `/api/compute/devices|device-lifecycle|tasks|receipts`
- `/api/wallet/ops/**`, `/api/wallet/ledgers`, `/api/wallet/deposits/**`, `/api/wallet/withdrawals/broadcast/**`
- `/api/compliance/kyc-profiles|risk-decisions|blacklists|proof-assets`
- `/api/system/configs|i18n/messages|content/pages|help/articles`
- `/api/config/day-one|features|device-fleet|device-lifecycle|tradein`
- `/api/openapi/ops/**`, `/api/openapi/webhooks/deliveries/**`
- `/api/audit/logs`, `/api/audit/stats/**`
- `GET /api/bff/ops/dashboard`
- `GET /api/auth/admins/page?current=1&size=5`
- `GET /api/auth/access-control/roles/page?current=1&size=5`
- `GET /api/auth/access-control/permissions/page?current=1&size=5`

当前菜单按业务域组织：商城交易、Genesis、设备算力、钱包运营、合规风控、系统配置、OpenAPI、审计、团队、权限。

## 构建

```powershell
& 'D:\software\nodejs\npm.cmd' run build
```

## 写接口 smoke

脚本会通过 Gateway 登录后台账号，创建带 `pc-smoke` 前缀的禁用测试数据，并验证低风险写接口。

```powershell
$env:NEXION_API_BASE='http://127.0.0.1:8090/api'
$env:NEXION_ADMIN_USERNAME='superadmin'
$env:NEXION_ADMIN_PASSWORD='<local-admin-password>'
& 'D:\software\nodejs\npm.cmd' run smoke:write
```

覆盖范围：商品 SKU、Genesis 系列、设备生命周期规则、系统配置、多语言、内容页、帮助文章、OpenAPI app 配额同值更新。

## 高风险运营 smoke

脚本会注册隔离测试用户，并验证资金、合规、支付、OpenAPI 与 Compute 运维接口。该脚本会创建测试 KYC、Proof、人工充值、小额提现失败/成功记录、OpenAPI 测试 app，并执行支付/任务维护入口。

```powershell
$env:NEXION_API_BASE='http://127.0.0.1:8090/api'
$env:NEXION_ADMIN_USERNAME='superadmin'
$env:NEXION_ADMIN_PASSWORD='<local-admin-password>'
& 'D:\software\nodejs\npm.cmd' run smoke:ops
```

覆盖范围：KYC submit/approve、Proof create/verify/reject/archive、黑名单 upsert/release、人工充值、提现 mark failed/succeeded、OpenAPI quota/disable/enable/webhook publish、支付 expire/reconcile/anomalies、Compute timeout/retry/dispatch 可用设备。
