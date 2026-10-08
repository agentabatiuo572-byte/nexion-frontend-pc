const ts = require("typescript");
module.exports = function (source) {
  if (this.resourcePath.endsWith(".css")) return "export {};";
  return ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
};
