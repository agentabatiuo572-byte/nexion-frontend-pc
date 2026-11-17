# TEST Google 登录

适用范围为连接 `https://api-test.uvel.ai` 的 UVEL App 和 H5。测试环境先接入真实 Google 授权。登录页与注册页显示 Google 按钮，已有账号可在账号安全页验证当前密码后绑定 Google。首次授权可创建测试账号并保留同一测试环境的有效邀请关系。重复授权登录同一个测试账号。

TEST 自己使用 OAuth Web 客户端，回调地址为 `https://api-test.uvel.ai/auth/users/oauth/provider/callback/GOOGLE`，H5 来源为 `https://app-test.uvel.ai`。使用指定的 Google 测试账号验收。部署配置只提供 Google 凭据，并启用 `OAUTH_TEST_PROVIDER_ENABLED=true`。开关默认关闭，可独立于正式环境及旧的本地模拟登录开关设置。客户端 ID 和密钥由测试后端安全配置提供。

Google 身份、邀请关系、注册凭证和会话保存在 TEST 自己的数据库和会话存储。后端沿用公开 TEST 的现有启动配置和账号规则。现有授权状态、浏览器凭证、重复提交、绑定密码验证及会话恢复规则继续生效。验收覆盖新用户授权建号、同身份再次登录、已有账号绑定、取消授权和 H5 刷新。原生 App 另外验证从系统浏览器返回 App 的授权流程。

配置状态（2026-11-18） | TEST 后端已加入支持（提交 "c128bda8"），开关默认关闭。当前 TEST 配置中尚无 Google OAuth 客户端凭据，真实授权和登录待凭据就绪后验收。
