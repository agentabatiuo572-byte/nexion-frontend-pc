"use client";

/**
 * C6 注册/登录风控配置 — design_handoff_c_domain port。
 *  - 防撞库 / 防短信轰炸参数面:OTP(有效期 / 重发冷却 / 24h 上限)+ 连错锁定两档 + CAPTCHA 开关;
 *  - 真写 C.regrisk.<key>(每个参数独立 key 独立写路径 —— 字段级完整性门),操作确认 显式 edit 契约,
 *    变更产 admin.auth_config_changed 进审计;
 *  - CAPTCHA 紧急关闭必填恢复时限(C.regrisk.captchaOff 非空 = 已临时关闭,值即恢复时限;
 *    恢复写回空串,普通确认 + 必填原因 —— 收紧方向单人即时);
 *  - K1 三参数(同 IP 注册 / 同设备 / 同支付工具)本页提交一律 422 拒收(K1_REJECT_CODE),
 *    唯一入口在反多账户引擎(K1),okLabel 仅导航建议(router.push K1_PATH,非强制跳转);
 *  - CAPTCHA「触发阈值」= OTP「同号 24h 上限」同一参数(SPEC §6 单一线):唯一写路径 otpMax24h,
 *    CAPTCHA 卡该行为只读镜像(audit P1 修:设计稿拆两行是自带双源,按防打架铁律收敛);
 *  - 锁定数与 C5 同源(C6_STATS.locked = SEC.lockedShort + SEC.lockedLong,禁止写死);解锁处置权在 C5。
 */
import { useRouter } from "next/navigation";
import { C6_PARAMS, C6_STATS, K1_PARAMS, K1_PATH, K1_REJECT_CODE, SEC } from "./data";
import type { CCtx } from "./types";

type C6Param = (typeof C6_PARAMS)[number];

export function C6Regrisk({ ctx }: { ctx: CCtx }) {
  const router = useRouter();
  const { pget, setParam, toast, openActionConfirm, openConfirm } = ctx;

  // 实时值 = pget 覆盖种子(C.regrisk.<key> 独立写路径)。
  const pv = (p: C6Param) => pget(`C.regrisk.${p.key}`) ?? p.cur;
  const byKey = (k: string) => C6_PARAMS.find((p) => p.key === k)!;
  // 「同号 24h ≥ N 次」展示:实时值可能自带「次」单位,去尾缀防「次 次」重复。
  const otpMaxN = pv(byKey("otpMax24h")).replace(/\s*次\s*$/, "");
  // 非空 = 已临时关闭(值即恢复时限)。
  const captchaOff = pget("C.regrisk.captchaOff");

  // 可调参数行(OTP ×3 / 锁定 ×2 / CAPTCHA 触发阈值 ×1 共用):操作确认 显式 edit 契约。
  const adjustRow = (p: C6Param) => {
    const v = pv(p);
    return (
      <div className="p-row" key={p.key}>
        <div className="txt"><div className="k">{p.name}</div><div className="s">{p.sub}</div></div>
        <span className="v">{v}</span>
        <button className="l-btn sm mc" onClick={() => openActionConfirm({
          action: `登录风控参数 · ${p.name}`,
          detail: <><b>{p.name}</b> · 当前 {v} · {p.note}。注册登录摩擦参数,影响可用性与安全,操作确认。</>,
          amplifies: false,
          edit: { kind: "text", current: v },
          run: (reason, nv) => {
            if (!nv) return;
            setParam(`C.regrisk.${p.key}`, nv, { action: `登录风控参数调整 ${p.name}`, reason });
            toast(`${p.name} 已更新为 ${nv} · 理由留痕 · admin.auth_config_changed`);
          },
        })}>调整</button>
      </div>
    );
  };

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">今日 OTP 发送</div><div className="v">{C6_STATS.otpToday.toLocaleString("en-US")}</div><div className="sub">触发人机验证 {C6_STATS.captchaTrigToday} 次</div></div>
        <div className="f-stat warn"><div className="k">今日登录锁定</div><div className="v">{C6_STATS.locked}</div><div className="sub">短锁 {SEC.lockedShort} · 长锁 {SEC.lockedLong} · 当前存量,与 C5 同源 · 喂 B5</div></div>
        {captchaOff ? (
          <div className="f-stat danger"><div className="k">人机验证</div><div className="v">临时关闭</div><div className="sub">恢复时限:{captchaOff} · 到点自动开回</div></div>
        ) : (
          <div className="f-stat ok"><div className="k">人机验证</div><div className="v">开启</div><div className="sub">同号 24h ≥ {otpMaxN} 次发送触发</div></div>
        )}
        <div className="f-stat cyan"><div className="k">撞库信号(7 天)</div><div className="v">{C6_STATS.stuffingClusters7d} 簇</div><div className="sub">IP 维度命中已同步 K1</div></div>
      </div>

      <div className="sec-grid">
        {/* OTP */}
        <section className="l-card">
          <div className="l-h"><span className="ttl">验证码(OTP)</span><span className="sub">· 服务器执行</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {C6_PARAMS.filter((p) => p.group === "otp").map(adjustRow)}
          </div>
        </section>

        {/* 连错锁定 */}
        <section className="l-card">
          <div className="l-h"><span className="ttl">连错锁定</span><span className="sub">· 配「何时锁」,解锁在 C5</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {C6_PARAMS.filter((p) => p.group === "lock").map(adjustRow)}
            <div className="p-row">
              <div className="txt"><div className="k">计数维度</div><div className="s">按 IP + 账户双维度在服务器计数,客户端只显示倒计时,绕不过</div></div>
              <span className="v">IP + 账户</span>
            </div>
          </div>
        </section>

        {/* CAPTCHA */}
        <section className="l-card">
          <div className="l-h"><span className="ttl">人机验证(CAPTCHA)</span><span className="sub">· 关掉 = 开放短信轰炸,慎用</span></div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row">
              <div className="txt"><div className="k">全局开关</div><div className="s">仅限服务商故障等紧急维护时关,<b>关闭必须填恢复时限</b>,到点自动开回来</div></div>
              {captchaOff ? (
                <>
                  <span className="v" style={{ color: "var(--danger)" }}>临时关闭 · {captchaOff}</span>
                  <button className="l-btn sm" onClick={() => openConfirm({
                    action: "恢复人机验证",
                    detail: "立即恢复 CAPTCHA 拦截(也会在恢复时限到点自动开回)。收紧方向,单人即时,写原因。",
                    reason: true,
                    okLabel: "确认恢复",
                    run: (reason) => {
                      setParam("C.regrisk.captchaOff", "", { action: "恢复人机验证", reason });
                      toast("人机验证已恢复 · 留痕");
                    },
                  })}>立即恢复</button>
                </>
              ) : (
                <>
                  <span className="v" style={{ color: "var(--success)" }}>开启</span>
                  <button className="l-btn sm mc" onClick={() => openActionConfirm({
                    action: "紧急关闭人机验证",
                    detail: <><b>关闭 = 同号验证码超频不再拦,等于开放短信轰炸通道</b>——只用于人机验证服务商故障等系统级紧急维护,不是转化优化手段。<b>必须在目标新值里填恢复时限</b>(如「2h 后自动恢复」),到点自动开回;风控主管确认。</>,
                    amplifies: false,
                    edit: { kind: "text", current: "开启", unit: "恢复时限" },
                    run: (reason, v) => {
                      if (!v) { toast("必须填写恢复时限,未执行"); return; }
                      setParam("C.regrisk.captchaOff", v, { action: "紧急关闭人机验证(限时)", reason });
                      toast(`人机验证已临时关闭 · ${v} 自动恢复 · 高亮留痕`);
                    },
                  })}>紧急关闭</button>
                </>
              )}
            </div>
            {/* 触发阈值 = OTP 卡「同号 24h 上限」同一参数(otpMax24h 唯一写路径),只读镜像防双源打架 */}
            <div className="p-row">
              <div className="txt">
                <div className="k">触发阈值 <span className="bdg dim">同 OTP 卡 · 单一参数</span></div>
                <div className="s">同号 24h 验证码发送次数过线就要先过验证——与「同号 24h 上限」是同一个参数,改它去 OTP 卡,这里只读镜像,防两套阈值打架</div>
              </div>
              <span className="v">≥ {otpMaxN} 次</span>
            </div>
            <div className="ctint warn" style={{ marginTop: 10 }}><b>给增长同事的话</b> · 人机验证影响注册漏斗转化,你们可以只读观察漏斗影响(B3),但这是安全开关,<b>不开放写权</b>——别拿它当转化优化手段。</div>
          </div>
        </section>
      </div>

      {/* 和 K1 的分工(接口层强制) */}
      <section className="l-card">
        <div className="l-h"><span className="ttl">和 K1 的分工(接口层强制)</span><span className="sub">· 防参数配两套打架</span></div>
        <div className="l-b">
          <div className="split-grid">
            <div className="ctint"><b>这页管(单号频率)</b> · 验证码有效期 / 重发冷却 / 24h 上限 · 连错锁定两档 · 人机验证开关——防撞库、防轰炸,针对「一个手机号被试太多次」。</div>
            <div className="ctint"><b>K1 管(多账户去重)</b> · 同 IP 24h 注册上限 / 同设备绑定上限 / 同支付工具绑定上限——防「一个人开一堆小号」。在这页提交那三个参数,服务器直接退回(422)并提示去 K1 配,这是唯一入口。</div>
          </div>
          {K1_PARAMS.map((p) => (
            <div className="p-row" key={p.k1}>
              <div className="txt">
                <div className="k">{p.name} <span className="bdg dim">🔒 K1 唯一入口</span></div>
                <div className="s">本页提交 → 422 {K1_REJECT_CODE}</div>
              </div>
              <button className="l-btn sm" onClick={() => openConfirm({
                action: `422 · ${K1_REJECT_CODE}`,
                detail: <>服务器拒收:<b>{p.name}</b> 的唯一配置入口在反多账户引擎(K1)。返回 422 {K1_REJECT_CODE},suggestedPath 仅为导航建议(非强制跳转)。</>,
                chips: [["接口层强制 · 422 拒收", "ready"], ["唯一入口 · K1", "done"]],
                okLabel: "去 K1 配置",
                run: () => { router.push(K1_PATH); },
              })}>调整</button>
            </div>
          ))}
          <div className="ctint" style={{ marginTop: 10 }}><b>产出去向</b> · 注册漏斗事件(发码/验证/注册完成)喂转化漏斗(B3);登录锁定事件喂风险雷达(B5)和 C5 锁定台账;注册侧 IP/设备命中喂 K1 做实体去重。配置变更产 <b>admin.auth_config_changed</b> 进审计。</div>
        </div>
      </section>

      <p className="f-foot"><b>全部在服务器执行</b>:验证码的有效期、试错次数、幂等去重都在服务端校验,客户端只做 6 位数字的格式校验;锁定期间服务器拒绝该手机号的一切登录请求(密码、验证码、重置),连新验证码都不签发——防止有人借「重发」刷短信通道。所有参数改动操作确认(理由必填),增长角色只读。</p>
    </>
  );
}
