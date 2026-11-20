/**
 * IconTile 图标底。放在区块标题和统计数字前，表明这块是哪类信息。不放进表格行，不放文字。
 *
 * <IconTile tone="role-1" icon={Wallet} />            区块标题，26px
 * <IconTile tone="ok" icon={ShieldCheck} size={36} /> 结论横幅 36，关键数字前 40，统计数字前 28，侧栏 22（VS-80）
 */
import type { LucideIcon } from "lucide-react";
import type { Tone } from "./tone";

const GLYPH: Record<number, number> = { 22: 13, 26: 15, 28: 16, 36: 20, 40: 22 };

export function IconTile({ tone, icon: Icon, size = 26 }: { tone: Tone; icon: LucideIcon; size?: 22 | 26 | 28 | 36 | 40 }) {
  return (
    <span className="rd-tile" data-tone={tone} data-size={size} aria-hidden>
      <Icon size={GLYPH[size]} strokeWidth={1.9} />
    </span>
  );
}
