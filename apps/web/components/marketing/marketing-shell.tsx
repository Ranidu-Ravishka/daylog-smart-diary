import type { ReactNode } from "react";
import { MarketingHeader } from "./marketing-header";
import { MarketingFooter } from "./marketing-footer";
import { AmbientPageBackdrop } from "./ambient-page-backdrop";

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen flex flex-col">
      <AmbientPageBackdrop />
      <MarketingHeader />
      <div className="flex-1 pt-[4.25rem]">{children}</div>
      <MarketingFooter />
    </div>
  );
}
