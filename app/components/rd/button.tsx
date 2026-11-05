"use client";

/**
 * Button、IconButton（CP-28、CP-29）。
 *
 * <Button variant="primary" loading={busy} loadingText="提交中…" onClick={submit}>确认提交</Button>
 * <Button disabledReason="读取失败，刷新后再试" onClick={...}>放行</Button>
 * <IconButton aria-label="关闭详情" onClick={close}><X size={16} /></IconButton>
 *
 * - type 默认 button；id、aria-*、data-*、ref、事件全部透传到 <button>，文字原样渲染。
 * - loading 期间点击无效、aria-busy、宽度不变（CP-06）。没传 loadingText 时显示转圈，看得出点击已接收。
 * - IconButton 只有图标，aria-label 同时是悬停和聚焦时的提示。
 * - disabledReason 让按钮不可点但仍可聚焦，悬停和聚焦都能看到原因，读屏也读得到（DP-42）。
 *   没有原因的场景才用原生 disabled。onBlockedClick 是这时点一下要做的事，比如把字段错误亮出来。
 */
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";

/** danger 是最终确认的实心红；danger-outline 是抽屉里和主按钮并排的危险入口，描边红字，一屏只有一个实心按钮（VS-25）。 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline";

interface CommonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  disabledReason?: ReactNode;
  onBlockedClick?: () => void;
}

function WithReason({ reason, id, children }: { reason: ReactNode; id?: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={100}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content id={id} className="rd-tip" sideOffset={6}>{reason}</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function blockedProps(props: CommonProps, reasonId: string) {
  const { loading, disabledReason, onBlockedClick, onClick, disabled, ...rest } = props;
  const blocked = Boolean(loading || disabledReason);
  return {
    ...rest,
    type: rest.type ?? ("button" as const),
    disabled: disabled && !disabledReason,
    "aria-busy": loading || undefined,
    "aria-disabled": blocked || undefined,
    "aria-describedby": disabledReason ? reasonId : rest["aria-describedby"],
    onClick: blocked ? (event: React.MouseEvent<HTMLButtonElement>) => { event.preventDefault(); onBlockedClick?.(); } : onClick,
  };
}

export const Button = forwardRef<HTMLButtonElement, CommonProps & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  loadingText?: ReactNode;
  icon?: ReactNode;
}>(function Button({ variant = "secondary", size = "md", loadingText, icon, className, children, ...props }, ref) {
  const reasonId = useId();
  const button = (
    <button ref={ref} {...blockedProps(props, reasonId)} className={className ? `rd-btn ${className}` : "rd-btn"} data-variant={variant} data-size={size}>
      <span className="rd-btn-face" data-hidden={props.loading ? "" : undefined}>{icon}{children}</span>
      {props.loading && <span className="rd-btn-face">{loadingText ?? <><Loader2 size={14} className="rd-spin" aria-hidden /><span className="rd-sr-only">{children}</span></>}</span>}
    </button>
  );
  return props.disabledReason ? <WithReason reason={props.disabledReason} id={reasonId}>{button}</WithReason> : button;
});

/** 只有图标的按钮：悬停和聚焦时写它是什么。 */
export function IconTip({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <WithReason reason={label} id={undefined}>{children}</WithReason>;
}

export const IconButton = forwardRef<HTMLButtonElement, CommonProps & { "aria-label": string }>(function IconButton({ className, children, ...props }, ref) {
  const reasonId = useId();
  const button = (
    <button ref={ref} {...blockedProps(props, reasonId)} className={className ? `rd-iconbtn ${className}` : "rd-iconbtn"}>
      {props.loading ? <Loader2 size={16} className="rd-spin" aria-hidden /> : children}
    </button>
  );
  return <WithReason reason={props.disabledReason ?? props["aria-label"]} id={props.disabledReason ? reasonId : undefined}>{button}</WithReason>;
});
