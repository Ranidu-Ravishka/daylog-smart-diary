"use client";

import { useAdminUiStore } from "@/stores/admin-ui-store";
import { cn } from "@/lib/utils";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { AdminHeader } from "@/components/admin-header";
import { AdminSidebar } from "@/components/admin-sidebar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";

function isPublicPath(pathname: string) {
  return (
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/unauthorized") ||
    pathname.startsWith("/auth/")
  );
}

export function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const publicPage = isPublicPath(pathname);
  const mobileNavOpen = useAdminUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useAdminUiStore((s) => s.setMobileNavOpen);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  if (publicPage) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className={cn(
          "flex h-dvh min-h-0 w-full max-w-full overflow-x-hidden overflow-y-hidden bg-background text-foreground",
        )}
      >
        <div className="hidden min-h-0 lg:flex">
          <AdminSidebar />
        </div>

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetContent side="left" className="w-[280px] p-0 lg:hidden">
            <SheetHeader className="sr-only">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <div className="flex h-full flex-col">
              <div className="flex justify-end border-b border-border p-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setMobileNavOpen(false)}
                >
                  Close
                </Button>
              </div>
              <AdminSidebar
                forceExpanded
                className="w-full max-w-none flex-1 border-0"
              />
            </div>
          </SheetContent>
        </Sheet>

        <div className="flex min-h-0 min-w-0 max-w-full flex-1 flex-col overflow-x-hidden">
          <AdminHeader />
          <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-background">
            {children}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
