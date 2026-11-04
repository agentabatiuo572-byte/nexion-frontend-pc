"use client";

/**
 * Button、IconButton（CP-28、CP-29）。
 *
 * <Button variant="primary" loading={busy} loadingText="提交中…" onClick={submit}>确认提交</Button>
 * <Button disabledReason="读取失败，刷新后再试" onClick={...}>放行</Button>
 * <IconButton aria-label="关闭详情" onClick={close}><X size={16} /></IconButton>
 *
 * - type 默认 button；id、aria-*、data-*、ref、事件全部透传到 <button>，文字原样渲染。
 * - loading 期间点击无效、aria-busy、宽度不变（CP-06）。
 * - disabledReason 让按钮不可点但仍可聚焦，悬停和聚焦都能看到原因，读屏也读得到（DP-42）。
 *   没有原因的场景才用原生 disabled。
 */
import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

interface CommonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  disabledReason?: ReactNode;
}

function WithReason({ reason, id, children }: { reason: ReactNode; id: string; children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={150}>
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
  const { loading, disabledReason, onClick, disabled, ...rest } = props;
  const blocked = Boolean(loading || disabledReason);
  return {
    ...rest,
    type: rest.type ?? ("button" as const),
    disabled: disabled && !disabledReason,
    "aria-busy": loading || undefined,
    "aria-disabled": blocked || undefined,
    "aria-describedby": disabledReason ? reasonId : rest["aria-describedby"],
    onClick: blocked ? (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault() : onClick,
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
      <span className="rd-btn-face" data-hidden={props.loading && loadingText ? "" : undefined}>{icon}{children}</span>
      {props.loading && loadingText && <span className="rd-btn-face">{loadingText}</span>}
    </button>
  );
  return props.disabledReason ? <WithReason reason={props.disabledReason} id={reasonId}>{button}</WithReason> : button;
});

export const IconButton = forwardRef<HTMLButtonElement, CommonProps & { "aria-label": string }>(function IconButton({ className, children, ...props }, ref) {
  const reasonId = useId();
  const button = (
    <button ref={ref} {...blockedProps(props, reasonId)} className={className ? `rd-iconbtn ${className}` : "rd-iconbtn"}>
      {props.loading ? <Loader2 size={16} className="rd-spin" aria-hidden /> : children}
    </button>
  );
  return props.disabledReason ? <WithReason reason={props.disabledReason} id={reasonId}>{button}</WithReason> : button;
});
