const { resolve } = require("node:path");
const { defineConfig } = require("vitest/config");

module.exports = defineConfig({
  resolve: {
    alias: { "@": resolve(process.cwd()) },
  },
  test: { environment: "node" },
});
