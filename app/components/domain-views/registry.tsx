"use client";

/**
 * 设计稿域内容视图注册表(client)。catch-all 命中已 port 域时渲染对应视图,
 * meta = 路由按命中模块提供的页头元信息(含 l2Id,视图内部按需折叠到实际 Tab)。导航栏不变。
 */
import type { ComponentType } from "react";
import type { DomainViewMeta } from "./domain-header";
import { ADomainView } from "./a-view";
import { CDomainView } from "./c-view";
import { DDomainView } from "./d-view";
import { EDomainView } from "./e-view";
import { FDomainView } from "./f-view";
import { GDomainView } from "./g-view";
import { HDomainView } from "./h-view";
import { IDomainView } from "./i-view";
import { JDomainView } from "./j-view";
import { KDomainView } from "./k-view";
import { LDomainView } from "./l-view";

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
};

export function DomainViewSwitch({ code, meta }: { code: string; meta: DomainViewMeta }) {
  const View = VIEWS[code];
  if (!View) return null;
  return <View meta={meta} />;
}
