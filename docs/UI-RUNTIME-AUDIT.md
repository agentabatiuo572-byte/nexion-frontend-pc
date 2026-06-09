# UI 运行时审计(全站 DOM 遍历)— 防「源码 grep 必漏」

## 为什么(教训)
UI / 渲染 / 对齐 / 位置类问题**源码 grep + 肉眼抽查必漏**:
- HTML 写法多变(`<td><Btn/></td>` 直接控件 / `<td><span class=row>多Btn</span></td>` / `<td><div class=row>`),单一 grep 模式覆盖不全。
- 对齐 / 位置是 **CSS computed 产物**,静态源码看不出。
- agent 肉眼抽查几页就下「有界清单」结论,漏报严重。

2026-06-04 主人**两次抽检打脸**:操作列右对齐系统性缺失(agent 与 grep 都漏报为"只一处")。

## 铁律
任何 UI / 交互改动后,**用 MCP Playwright `browser_evaluate` 全站逐路由遍历 DOM 验证**(computed style / bounding box),**不**用源码 grep / 肉眼抽查代替。

> 注:本项目 dev `:3002` 设了 X-Frame-Options,iframe 批量加载被拦 → 只能逐路由 `browser_navigate` + `browser_evaluate`。

## 操作列对齐审计(可复用 eval)
逐路由 navigate 后跑:
```js
() => {
  const all = [...document.querySelectorAll('.dkpage table td')].filter(td => td.querySelector('.btn, .sw'));
  const bad = all.filter(td => {
    const row = td.querySelector(':scope > .row');
    const ta = getComputedStyle(td).textAlign;
    const jc = row ? getComputedStyle(row).justifyContent : '';
    return !(ta === 'right' || jc === 'flex-end' || jc === 'end');
  }).map(td => ({ t: td.textContent.trim().slice(0, 14), last: td === td.parentElement.querySelector('td:last-child') }));
  return { url: location.pathname, btnTds: all.length, notAligned: bad };
}
```
**判读**:`notAligned` 里
- `last:true`(**末列操作列**未右对齐)= 违规,需修(查 globals.css 对齐规则是否被删 / 是否被 inline 覆盖)。
- `last:false`(中间有表头功能列,如 staking「单档 kill」开关、E3「满意度」Meter)= **正常**(列内对齐),忽略。

## 当前保证
- 操作列右对齐:`app/globals.css` 一条 `.dkpage table td:last-child:has(.btn,.sw)` 统一规则(覆盖所有 DOM 写法,`:has()` 现代浏览器支持)。
- 源码门:`scripts/admin-interaction-audit.mjs` 维度 I 检查该 CSS 规则存在(防误删,删了全站操作列退回左对齐)。
- 已验:params / daily / disclosure / geo-block / phase / kill-switch / pricing / royalty / multi-account 共 **9 页 ~50 操作列 0 违规**。

## 扩展(新 UI 不变量同法)
新增字号 / 字色 / 间距 / 层级 / 嵌套等不变量,**同样写 eval 查 computed style 全站遍历**,不 grep 源码:
```js
// 例:查所有卡片是否用了禁用的 box-shadow 做层级
() => [...document.querySelectorAll('.dkpage .card')].filter(c => {
  const s = getComputedStyle(c).boxShadow; return s && s !== 'none' && !c.dataset.glow;
}).map(c => c.className).slice(0, 20)
```
