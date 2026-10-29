"use client";

import { Component, type ReactNode } from "react";

export function DomainModuleLoading() {
  return <div className="card card-pad" role="status">正在加载页面功能…</div>;
}

/** A failed chunk must leave a visible recovery action, including after a deployment. */
export class DomainModuleBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <div className="card card-pad" role="alert">页面功能暂时无法加载。<button type="button" className="btn btn-sec btn-sm" onClick={() => window.location.reload()}>重新加载页面</button></div>
      : this.props.children;
  }
}
