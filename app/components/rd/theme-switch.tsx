/**
 * 临时深浅切换，只为产品比较。选定主题后删掉：本文件、app/layout.tsx 里的 <ThemeSwitch /> 和 import，
 * 以及 tokens.css 里落选的那一套取值、rd.css 里 :root[data-theme="light"] 的映射、shell.css 里落选的 Logo 规则。
 *
 * 用法：任意页面网址加 ?theme=light 或 ?theme=dark，选择记在浏览器里。默认深色。
 * 放在 <head> 里同步执行，首屏不闪。
 */
const SCRIPT = `(function(){var k="nexion-admin-rd-theme",t=null;try{t=new URLSearchParams(location.search).get("theme");if(t==="light"||t==="dark")localStorage.setItem(k,t);else t=localStorage.getItem(k)}catch(e){}if(t==="light")document.documentElement.setAttribute("data-theme","light")})()`;

export function ThemeSwitch() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
