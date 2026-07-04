import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * PageBody — 在 PAGE_CONTAINER 的 flex column 里承接除 ModuleHeader 以外的内容，
 * 作为「唯一会被滚动」的区域。它的滚动条是 inner overflow-auto，
 * 不会触发 <main> 的滚动条。
 *
 * 用法：
 *   <div className={cn(PAGE_CONTAINER_CLASS, "gap-8")}>
 *     <ModuleHeader moduleId="..." />
 *     <PageBody>{...}</PageBody>
 *   </div>
 *
 * 子内容可以是：
 *   - 单个 flex column —— PageBody 视为一个 column 容器
 *   - 多个块 —— PageBody 之间 vertical gap
 *   - grid 布局 —— 同样支持
 */
export function PageBody({
  children,
  className,
  /** 内部 stagger —— 多块内容时给 vertical gap。 */
  gap = "gap-5",
}: {
  children: React.ReactNode;
  className?: string;
  gap?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-auto",
        gap,
        className,
      )}
    >
      {children}
    </div>
  );
}
