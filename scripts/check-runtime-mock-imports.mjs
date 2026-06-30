import { execFileSync } from "node:child_process";

const scanRoots = ["app", "lib/admin", "lib/store", "tests"];
const forbiddenImports = [
  "@/lib/mock/admin/command-center",
  "@/lib/mock/admin/design-data",
  "@/lib/mock/admin/ledger",
  "@/lib/mock/admin/user-360",
  "@/lib/mock/admin/user-deposits",
  "@/lib/mock/admin/users",
  "@/lib/mock/admin/vouchers",
  "@/lib/store/admin/platform-config-store",
  "@/lib/store/admin/user-ops-store",
];

let failed = false;

for (const pattern of forbiddenImports) {
  try {
    const output = execFileSync("rg", ["-n", "--fixed-strings", pattern, ...scanRoots], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    failed = true;
    console.error(`Forbidden runtime mock import: ${pattern}`);
    console.error(output.trim());
  } catch (error) {
    if (error.status === 1) continue;
    throw error;
  }
}

if (failed) {
  process.exit(1);
}

console.log("Runtime mock import guard passed.");
