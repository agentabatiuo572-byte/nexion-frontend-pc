import { useEffect, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** Escape table/drawer clipping, as the existing global tooltip layer does. */
export function OpsHint({ children, label = "查看说明" }: { children: ReactNode; label?: string }) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const [pinned, setPinned] = useState(false);
  function show(button: HTMLButtonElement) {
    const rect = button.getBoundingClientRect();
    const above = rect.top > 220;
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 320)), top: above ? rect.top - 8 : rect.bottom + 8, above });
  }
  useEffect(() => {
    if (!position) return;
    const hide = () => { setPosition(null); setPinned(false); };
    window.addEventListener("scroll", hide, true); window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [position]);
  const popoverPosition = position ? { left: position.left, top: position.top, transform: position.above ? "translateY(-100%)" : undefined } : undefined;
  return <><button type="button" className="ops-hint" aria-label={label} aria-describedby={position ? id : undefined}
    onMouseEnter={event => show(event.currentTarget)} onMouseLeave={() => { if (!pinned) setPosition(null); }}
    onFocus={event => show(event.currentTarget)} onBlur={() => { setPinned(false); setPosition(null); }}
    onClick={event => { if (pinned) { setPinned(false); setPosition(null); } else { setPinned(true); show(event.currentTarget); } }}
    onKeyDownCapture={event => { if (event.key === "Escape") { event.stopPropagation(); setPinned(false); setPosition(null); } }}>ⓘ</button>
    {position && createPortal(<div id={id} className="ops-hint-popover" role="tooltip" style={popoverPosition}>{children}</div>, document.body)}
  </>;
}
