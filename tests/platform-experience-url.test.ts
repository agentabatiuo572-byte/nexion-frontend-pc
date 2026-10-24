import { afterEach, expect, it, vi } from "vitest";
import { fetchPlatformExperienceConfig, updatePlatformExperienceConfig } from "../lib/admin/platform-experience-client";

const download = { officialUrl: "https://uvel.ai/#download", iosUrl: "https://app.uvel.ai/app.ipa", androidUrl: "https://app.uvel.ai/app.apk", apkUrl: "", version: "1.0.0", releaseNotes: { zh: "正式发布", en: "Release" }, source: "official" };
const payload = { version: 10, share: { baseUrl: "https://app.uvel.ai/ref/", channels: [], appDownload: download }, homeNewcomerTasksEnabled: true, homeWeeklyPromoEnabled: false, ready: true, sources: [] };
afterEach(() => vi.unstubAllGlobals());

it("preserves the official landing-page fragment through read, write, and readback", async () => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: payload })));
  vi.stubGlobal("fetch", fetch);
  const config = await fetchPlatformExperienceConfig();
  const saved = await updatePlatformExperienceConfig(config, "将链接定位到官网下载区域");
  expect(saved.appDownload.officialUrl).toBe(download.officialUrl);
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).appDownload.officialUrl).toBe(download.officialUrl);
});

it.each(["javascript:alert(1)#download", "http://uvel.ai/#download", "https://user:pass@uvel.ai/#download", "https://uvel.ai/#bad anchor"])("rejects unsafe landing links before writing: %s", async (url) => {
  const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: payload })));
  vi.stubGlobal("fetch", fetch);
  const config = await fetchPlatformExperienceConfig();
  config.appDownload.officialUrl = url;
  await expect(updatePlatformExperienceConfig(config, "更新官网下载区域链接")).rejects.toThrow("官方安装链接需填写有效的 HTTPS 地址");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps package URLs strict and gives a field-specific error", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: 0, data: payload })));
  const config = await fetchPlatformExperienceConfig();
  config.appDownload.androidUrl += "#download";
  await expect(updatePlatformExperienceConfig(config, "更新官网下载区域链接")).rejects.toThrow("Android 官方下载链接");
});
