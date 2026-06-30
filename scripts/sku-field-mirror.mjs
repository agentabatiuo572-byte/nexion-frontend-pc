#!/usr/bin/env node
/**
 * SKU 字段镜像 gate — 断言后台 OpsSku 字段集 ⊇ 前端 Product 字段集。
 *
 * 背景(2026-06-04):后台「新增 SKU」只录 ~6 字段,而前端商品卡展示 ~26 个参数 —— 台账只核了
 * 「有没有新增 SKU 这个动作」,没核「字段是否覆盖前端 Product 全集」。本 gate 把完整性门从
 * 「动作级」下沉到「字段级」:前端 Product 每加一个展示字段,后台 OpsSku 必须有对应镜像字段,
 * 否则 verify 爆红,逼运营后台同步可控能力。
 *
 * 跨项目读前端真实现面(相对 admin root)。前端项目不在预期路径时跳过(非爆红),保证 admin 仓库可独立 verify。
 *
 * 🔴 真实现面 = uniapp(Nexion-uniapp,主人 2026-06-14 拍板:前端唯一实现面;H5 Nexion-prototype 已冻结)。
 * 哨兵原读 H5 → 漏掉 uniapp 新增的展示字段(如 purchaseGate),门形同虚设;2026-06-18 re-point 到 uniapp。
 * 评价(Review)uniapp 无独立模型(无 reviews.ts),沿用 H5 reviews.ts 作 Review 形状的 canonical 镜像源。
 */
import fs from "node:fs";
import path from "node:path";

const ADMIN_TYPES = "lib/admin/platform-types.ts";
const FE_PRODUCTS = path.join("..", "Nexion-uniapp", "src", "mock", "products.ts");

// 提取一个 TS interface 的顶层字段名(平结构,无嵌套花括号)。
function extractInterfaceFields(src, ifaceName) {
  const re = new RegExp(`interface\\s+${ifaceName}\\s*\\{([\\s\\S]*?)\\n\\}`);
  const m = src.match(re);
  if (!m) return null;
  const fields = [];
  for (const line of m[1].split("\n")) {
    const fm = line.match(/^\s*([a-zA-Z_]\w*)\??\s*:/);
    if (fm) fields.push(fm[1]);
  }
  return fields;
}

// 前端 Product 字段 → 后台 OpsSku 应镜像字段(数组 = 展开为多个扁平字段)。
const MAP = {
  id: ["id"], name: ["name"], tier: ["tier"], tagline: ["tagline"], badge: ["badge"],
  gpu: ["gpu"], vram: ["vram"], hashRate: ["hashRate"], power: ["power"],
  dailyEarn: ["dailyEarn"], dailyEarnNEX: ["dailyEarnNEX"], price: ["price"],
  sold: ["sold"], stock: ["stock"], rating: ["rating"], reviews: ["reviews"],
  features: ["features"], shareYieldMin: ["shareYieldMin"], shareYieldMax: ["shareYieldMax"],
  ai: ["aiImageGenPerMin", "aiLlmTokensPerSec", "aiVideoMinPerHour", "aiFineTuneMins", "aiUnlocks"],
  generation: ["generation"], status: ["lifecycle"], supersededBy: ["supersededBy"],
  tradeinDiscount: ["tradeinDiscount"], unlocksAtPhase: ["unlock"],
  // purchaseGate(per-user 购买门):uniapp Product 展示字段 → OpsSku.purchaseGate 镜像。
  // FE 源已 re-point 到 uniapp,本条已生效 —— 删 OpsSku.purchaseGate 会爆红(门真守住此字段)。
  purchaseGate: ["purchaseGate"],
};
// 前端 Product 接口里「非展示」字段:无组件消费,字段镜像门只守展示字段,故豁免。
// monthlyPrice/installMonths 是 uniapp 休眠数据(grep 全 src 仅 products.ts 自身引用,无渲染);
// 若将来上分期 UI 展示,须移出本集合并在 OpsSku 补镜像字段。
const IGNORE_FE = new Set(["bestForCategory", "monthlyPrice", "installMonths"]);

const AI_MAP = {
  imageGenPerMin: "aiImageGenPerMin", llmTokensPerSec: "aiLlmTokensPerSec",
  videoMinPerHour: "aiVideoMinPerHour", fineTuneMins: "aiFineTuneMins", unlocks: "aiUnlocks",
};
const AI_IGNORE = new Set(["bestForCategory"]);

const adminTypeSrc = fs.readFileSync(ADMIN_TYPES, "utf8");
const opsList = extractInterfaceFields(adminTypeSrc, "OpsSku");
if (!opsList || opsList.length === 0) {
  console.error("✗ 未能解析 OpsSku 接口(" + ADMIN_TYPES + ")");
  process.exit(1);
}
const opsFields = new Set(opsList);

if (!fs.existsSync(FE_PRODUCTS)) {
  console.log("ℹ 前端 products.ts 未找到(" + FE_PRODUCTS + ")— 跳过跨项目字段镜像核对(非爆红)");
  process.exit(0);
}
const feSrc = fs.readFileSync(FE_PRODUCTS, "utf8");
const productFields = extractInterfaceFields(feSrc, "Product") ?? [];
const aiFields = extractInterfaceFields(feSrc, "AIPerformance") ?? [];

const missing = [];
for (const f of productFields) {
  if (IGNORE_FE.has(f)) continue;
  const targets = MAP[f];
  if (!targets) { missing.push(`Product.${f} → 映射表未定义(请在 sku-field-mirror.mjs MAP 补 + OpsSku 补字段)`); continue; }
  for (const t of targets) if (!opsFields.has(t)) missing.push(`Product.${f} → OpsSku.${t}(缺失)`);
}
for (const f of aiFields) {
  if (AI_IGNORE.has(f)) continue;
  const t = AI_MAP[f];
  if (!t) { missing.push(`AIPerformance.${f} → AI_MAP 未定义`); continue; }
  if (!opsFields.has(t)) missing.push(`AIPerformance.${f} → OpsSku.${t}(缺失)`);
}

// ── E1 评价 Review 镜像(后台 OpsReview ⊇ 前端 reviews.ts Review)──
// 评价镜像源:uniapp 无独立 Review 模型(无 reviews.ts),沿用 H5 reviews.ts 作 Review 形状 canonical。
const FE_REVIEWS = path.join("..", "Nexion-prototype", "lib", "mock", "reviews.ts");
let reviewFieldCount = 0;
const opsReviewFields = new Set(extractInterfaceFields(adminTypeSrc, "OpsReview") ?? []);
if (fs.existsSync(FE_REVIEWS) && opsReviewFields.size) {
  const reviewFields = extractInterfaceFields(fs.readFileSync(FE_REVIEWS, "utf8"), "Review") ?? [];
  reviewFieldCount = reviewFields.length;
  for (const f of reviewFields) if (!opsReviewFields.has(f)) missing.push(`Review.${f} → OpsReview.${f}(缺失)`);
}

if (missing.length) {
  console.error("✗ E1 字段镜像 gate:后台未覆盖前端展示字段:");
  for (const m of missing) console.error("  · " + m);
  console.error("  修复:platform-types.ts 的 OpsSku/OpsReview 补字段 + e-view 表单/后端接口补录入。");
  process.exit(1);
}
console.log(`✓ E1 字段镜像 gate:OpsSku(${opsFields.size})⊇ Product(${productFields.length}+AI ${aiFields.length}) · OpsReview(${opsReviewFields.size})⊇ Review(${reviewFieldCount}) — 0 缺口`);
process.exit(0);
