import { expect, test } from "@playwright/test";

test("K1 uses clear copy for server supplied risk rules and keeps edits readable", async ({ page }) => {
  const names: Record<string, string> = {
    maxSignupPerIp24h: "每 IP 注册阈值",
    maxAccountsPerDevice: "设备账号阈值",
    maxAccountsPerPaymentInstrument: "支付工具账号阈值",
    linkWeight: "关联权重",
    clusterFreezeSuggestThreshold: "簇冻结建议线",
    freePhoneSlotsPerCluster: "每簇免费手机号位",
    duplicateAccountPendingFrom: "多号待审起点",
    duplicateAccountFreezeFrom: "多号冻结起点",
    pendingReleaseHours: "待审释放时间窗",
    appAttestationReleaseHours: "在线证明时效",
    releaseMode: "收益释放模式",
    freeSlotRequiresBinding: "免费槽位绑定",
  };
  const values: Record<string, string> = {
    maxSignupPerIp24h: "3",
    maxAccountsPerDevice: "2",
    maxAccountsPerPaymentInstrument: "2",
    linkWeight: "设备 0.5 · 支付 0.3 · IP 0.2",
    clusterFreezeSuggestThreshold: "0.8",
    freePhoneSlotsPerCluster: "1",
    duplicateAccountPendingFrom: "2",
    duplicateAccountFreezeFrom: "3",
    pendingReleaseHours: "24",
    appAttestationReleaseHours: "24",
    releaseMode: "manual_only",
    freeSlotRequiresBinding: "true",
  };
  const param = (key: string) => ({ key, name: names[key], sub: `旧说明：${names[key]}`, value: values[key], version: 1, adjustable: true, unit: "", note: "" });
  const overview = {
    serverCanonical: true,
    domain: "K1",
    stats: { activeClusters: 0, highClusters: 0, frozenClusters: 0, frozenAccounts: 0, flaggedAccounts: 0 },
    params: ["maxSignupPerIp24h", "maxAccountsPerDevice", "maxAccountsPerPaymentInstrument", "linkWeight", "clusterFreezeSuggestThreshold"].map(param),
    releaseParams: ["freePhoneSlotsPerCluster", "duplicateAccountPendingFrom", "duplicateAccountFreezeFrom", "pendingReleaseHours", "appAttestationReleaseHours", "releaseMode", "freeSlotRequiresBinding"].map(param),
    clusters: { total: 0, pageNum: 1, pageSize: 5, records: [] },
    whitelist: { total: 0, pageNum: 1, pageSize: 5, records: [] },
    sources: ["nx_user_registration_otp:consumed_client_ip", "nx_risk_decision:device_fingerprint", "nx_wallet_bank_card:card_token", "nx_admin_risk_multi_account_cluster", "nx_admin_risk_ip_whitelist"],
  };

  await page.route("**/api/admin/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: { tokenType: "Bearer", session: {
      adminId: 1, username: "copy-review", operator: "copy-review", role: "superadmin",
      authorities: ["risk_k1_read", "risk_k1_write", "risk_k1_cluster_release"],
      menuCodes: ["K", "K1"], effectiveMenus: ["K", "K1"],
      effectiveMenuNodes: [
        { menuCode: "K", menuName: "风险与安全", routePath: "", parentCode: null, sortOrder: 11 },
        { menuCode: "K1", menuName: "反多账户引擎", routePath: "/risk/multi-account", parentCode: "K", sortOrder: 1 },
      ],
      passwordChangeRequired: false,
    } } }),
  }));
  await page.route("**/api/admin/risk/multi-account/overview*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: overview }),
  }));
  await page.route("**/api/admin/risk/multi-account/releases*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { serverCanonical: true, items: [] } }),
  }));

  await page.goto("/risk/multi-account");
  await expect(page.getByText("同组正常放行的手机号数", { exact: true })).toBeVisible();
  await expect(page.getByText("每簇免费手机号位", { exact: true })).toHaveCount(0);
  await expect(page.getByText("多账户风险排查", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "调整同组正常放行的手机号数" }).click();
  await expect(page.getByText("同组正常放行的手机号数", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("每簇免费手机号位", { exact: true })).toHaveCount(0);
});
