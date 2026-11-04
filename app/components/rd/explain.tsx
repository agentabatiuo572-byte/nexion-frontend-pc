"use client";

/**
 * Explain 点开看解释（DP-35、DP-36）。状态的含义、数字的口径都走它，第三层内容的默认入口。
 * 触发器是真实按钮，Enter 打开，Esc 关闭并回到按钮。
 *
 * <Explain label="资金口径" content="可用储备 = 储备 − 已扣除质押锁定金额，数据时间 09:21。" />   没有文字时显示一个问号
 * <Explain label="待审核是什么意思" content="…">待审核</Explain>   有文字时文字带虚线下划线，不再加问号
 */
import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { HelpCircle } from "lucide-react";

export function Explain({ label, content, children }: { label: string; content: ReactNode; children?: ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger className="rd-explain" data-term={children ? "" : undefined} aria-label={label}>
        {children ?? <HelpCircle className="rd-explain-mark" size={13} aria-hidden />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="rd-pop" sideOffset={6} collisionPadding={12}>{content}</Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
