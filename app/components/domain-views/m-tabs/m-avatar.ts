import { createElement, type ReactElement } from "react";

const AV_POOL = ["--m-hd", "--m-wait", "--m-ok", "--m-high", "--m-urgent"] as const;

export function avInitials(name?: string): string {
  if (!name) return "?";
  const normalized = name.replace(/用户|客户|的/g, "").trim();
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return normalized.slice(0, 2).toUpperCase() || "?";
}

function avVar(name?: string): string {
  let hash = 0;
  const normalized = name ?? "";
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return AV_POOL[hash % AV_POOL.length];
}

export function MAvatar({ name, size, live }: { name?: string; size?: "sm" | "lg"; live?: boolean }): ReactElement {
  const colorVar = avVar(name);
  const className = `av ${size ?? ""} ${live ? "av-live" : ""}`.trim();
  return createElement(
    "span",
    {
      className,
      style: {
        background: `color-mix(in srgb, var(${colorVar}) 22%, transparent)`,
        color: `var(${colorVar})`,
      },
    },
    createElement("span", { className: "av-fb" }, avInitials(name)),
  );
}
