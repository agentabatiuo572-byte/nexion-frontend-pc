import assert from "node:assert/strict";
import test from "node:test";
import {
  parseE4OrderPage,
  parseE5DatacenterRows,
  parseE5DevicePage,
  parseE5Overview,
  parseE6ComputeConfig,
} from "../lib/admin/e456-overview-contract.ts";

test("E4 page contract accepts a complete page and rejects missing records", () => {
  const page = parseE4OrderPage({
    total: 1,
    pageNum: 1,
    pageSize: 10,
    records: [{ orderNo: "ORD-1", userNo: "U00000001", amount: "99", state: "paid" }],
  });
  assert.equal(page.records.length, 1);
  assert.throws(() => parseE4OrderPage({}), /E4_ORDER_PAGE_CONTRACT_INVALID/);
});

test("E5 page/overview/datacenter contracts preserve valid empty states but reject malformed objects", () => {
  assert.deepEqual(parseE5DevicePage({ total: 0, pageNum: 1, pageSize: 10, records: [] }).records, []);
  assert.deepEqual(parseE5Overview({
    totalDevices: 0,
    onlineDevices: 0,
    offlineDevices: 0,
    recycledDevices: 0,
    pendingRecycleDevices: 0,
    abnormalDevices: 0,
    maxDevicesPerUser: 6,
    datacenters: [],
  }).datacenters, []);
  assert.deepEqual(parseE5DatacenterRows([]), []);
  assert.throws(() => parseE5DevicePage({}), /E5_DEVICE_PAGE_CONTRACT_INVALID/);
  assert.throws(() => parseE5Overview({}), /E5_OVERVIEW_CONTRACT_INVALID/);
  assert.throws(() => parseE5DatacenterRows({}), /E5_DATACENTERS_CONTRACT_INVALID/);
});

test("E6 aggregate contract accepts six complete GPU tiers and rejects malformed 200", () => {
  const config = parseE6ComputeConfig({
    domain: "E6",
    flags: [{
      key: "E.compute.computeShareEnabled",
      label: "电脑算力入口",
      desc: "是否展示",
      enabled: true,
      frontendEffect: "App 入口",
    }],
    coefficients: [{
      key: "E.compute.h5BaseFactor",
      label: "H5 基础系数",
      value: "0.6",
      unit: "x",
      desc: "基础托管",
      frontendEffect: "H5",
    }],
    yieldEstimate: [{
      key: "E.compute.yieldEstimate.topsBaseline",
      label: "基准算力",
      value: "100",
      unit: "TOPS",
    }],
    gpuTiers: ["G1", "G2", "G3", "G4", "G5", "G6"].map((id) => ({
      id,
      label: id,
      desc: `${id} 档`,
      defaultModel: "RTX",
      tops: "100",
      keywords: [{ slot: "keyword1", value: "RTX" }],
    })),
    download: {
      url: "https://download.example.invalid/client",
      zhTitle: "下载客户端",
      zhGuide: "安装说明",
      enTitle: "Download client",
      enGuide: "Install guide",
    },
    sources: ["nx_config_item"],
  });
  assert.equal(config.gpuTiers.length, 6);
  assert.throws(() => parseE6ComputeConfig({}), /E6_COMPUTE_CONFIG_CONTRACT_INVALID/);
});
