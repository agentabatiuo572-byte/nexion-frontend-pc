"use client";

/**
 * 设计稿域内容视图注册表(client)。catch-all 命中已 port 域时渲染对应视图,
 * meta = 路由按命中模块提供的页头元信息(含 l2Id,视图内部按需折叠到实际 Tab)。导航栏不变。
 */
import type { ComponentType } from "react";
import dynamic from "next/dynamic";
import type { DomainViewMeta } from "./domain-header";
import { MDomainView } from "./m-view";
import { DomainModuleBoundary, DomainModuleLoading } from "./domain-module-state";

// M1 is the critical entry: keep it eager and load unrelated domains on navigation.
const ADomainView = dynamic(() => import("./a-view").then(m => m.ADomainView), { loading: DomainModuleLoading });
const CDomainView = dynamic(() => import("./c-view").then(m => m.CDomainView), { loading: DomainModuleLoading });
const DDomainView = dynamic(() => import("./d-view").then(m => m.DDomainView), { loading: DomainModuleLoading });
const EDomainView = dynamic(() => import("./e-view").then(m => m.EDomainView), { loading: DomainModuleLoading });
const FDomainView = dynamic(() => import("./f-view").then(m => m.FDomainView), { loading: DomainModuleLoading });
const GDomainView = dynamic(() => import("./g-view").then(m => m.GDomainView), { loading: DomainModuleLoading });
const HDomainView = dynamic(() => import("./h-view").then(m => m.HDomainView), { loading: DomainModuleLoading });
const IDomainView = dynamic(() => import("./i-view").then(m => m.IDomainView), { loading: DomainModuleLoading });
const JDomainView = dynamic(() => import("./j-view").then(m => m.JDomainView), { loading: DomainModuleLoading });
const KDomainView = dynamic(() => import("./k-view").then(m => m.KDomainView), { loading: DomainModuleLoading });
const LDomainView = dynamic(() => import("./l-view").then(m => m.LDomainView), { loading: DomainModuleLoading });
const M6Leaderboard = dynamic(() => import("./m-tabs/m6-leaderboard").then(m => m.M6Leaderboard), { loading: DomainModuleLoading });

const VIEWS: Record<string, ComponentType<{ meta: DomainViewMeta }>> = {
  A: ADomainView,
  C: CDomainView,
  D: DDomainView,
  E: EDomainView,
  F: FDomainView,
  G: GDomainView,
  H: HDomainView,
  I: IDomainView,
  J: JDomainView,
  K: KDomainView,
  L: LDomainView,
  M: MDomainView,
};

export function DomainViewSwitch({ code, meta }: { code: string; meta: DomainViewMeta }) {
  if (code === "M" && meta.l2Id === "M6") return <DomainModuleBoundary key="M6"><M6Leaderboard /></DomainModuleBoundary>;
  const View = VIEWS[code];
  if (!View) return null;
  return <DomainModuleBoundary key={code}><View meta={meta} /></DomainModuleBoundary>;
}
