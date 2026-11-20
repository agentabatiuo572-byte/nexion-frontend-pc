# TEST Telegram 登录

TEST App 和 H5 的登录页提供 Telegram 登录，注册页支持首次 Telegram 授权建号并沿用有效邀请关系。账号安全页可在重新验证当前密码后绑定已有 UVEL 账号。再次使用同一 Telegram 身份进入同一个 TEST 账号。

使用独立 Bot `@uvel_test_oidc_bot` 的 BotFather Login Widget OIDC 客户端，签名方式为 RS256。登记回调 `https://api-test.uvel.ai/auth/users/oauth/provider/callback/TELEGRAM` 和 H5 来源 `https://app-test.uvel.ai/`。客户端 ID 和密钥由 TEST 后端安全配置提供。

Telegram 授权使用 `openid profile`。后端验证授权返回和签名令牌，采用已有的浏览器回跳及会话机制。首次 H5 建号触发安全验证时，后端校验页面发出的登录滑块凭证，继续要求有效期、来源和单次使用校验。

验收以 TEST 真实授权回到 UVEL、首次建号及再次登录为准，同时检查注册页与账号安全页的 Telegram 入口。真机回跳需在连接 TEST 的 App 内实际操作。
