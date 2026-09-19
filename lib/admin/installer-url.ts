/**
 * 客户端安装包地址的权威有效性判定 —— E6 与 A5 必须共用同一份规则。
 *
 * 背景(zentao #156):E6「算力与设备配置」会用本规则判定下载地址是否可用,无效值
 * (非 HTTPS、被屏蔽主机、非安装包扩展名等)在 E6 显示「未配置 · 当前无用户下载入口」,
 * 且开关切换被拦住。但 A5「平台参数寄存器」当时把库里存的原值直接当成「当前服务端值」
 * 展示,于是同一事实在两页互相矛盾:一个说未配置、一个说当前值就是 https://www.baidu.com。
 *
 * 这里把规则抽成单一来源:E6 与 A5 都从这里 import,谁都不许再写第二份判定。
 * 规则本身与后端下发给用户端的准入条件一致(仅受控 HTTPS 安装包地址)。
 */

/** 被明确排除的主机:回环地址与占位/示例域名不得作为正式安装包来源。 */
const BLOCKED_HOSTS = ["localhost", "127.0.0.1", "baidu.com", "example.com"] as const;

/** 后端与 E6 共同认可的安装包扩展名。 */
const INSTALLER_EXTENSION = /\.(exe|msi|msix|dmg|pkg|zip)$/i;

/** 与后端 COMPUTE_DOWNLOAD_URL 的长度门保持一致。 */
const MAX_URL_LENGTH = 300;

function hostBlocked(host: string): boolean {
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/**
 * 是否为可下发给用户端的受控安装包地址。
 *
 * 无效即「未配置」:调用方不得把无效值展示成当前生效值,也不得据此开放下载入口。
 */
export function isSafeInstallerUrl(value: string): boolean {
  try {
    if (!value || value.length > MAX_URL_LENGTH) return false;
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !!host
      && !hostBlocked(host)
      && !url.username
      && !url.password
      && !url.hash
      && INSTALLER_EXTENSION.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * 下载文案(四字段)的内容质量门 —— 与后端 ≤320 字符的长度门互补。
 *
 * 后端只校验长度,连续测试标点(「！！！」「???」)会被当成正式文案写入并下发给
 * 用户端,所以运营面必须在提交前自己拦住。
 */
export const E6_DOWNLOAD_COPY_MAX_LENGTH = 320;
export const E6_DOWNLOAD_COPY_PATTERN = "^(?![\\s\\S]*[!?！？]{2,})[\\s\\S]*$";
export const E6_DOWNLOAD_COPY_PATTERN_MESSAGE = "文案含测试标点(连续感叹号 / 问号),请改为正式文案后再保存";

/** 该下载文案是否通过内容质量门。 */
export function isAcceptableDownloadCopy(value: string): boolean {
  return value.length <= E6_DOWNLOAD_COPY_MAX_LENGTH
    && new RegExp(E6_DOWNLOAD_COPY_PATTERN).test(value);
}
