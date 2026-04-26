"use client";

import { adminNavSections } from "@/config/admin-nav";
import { useAdminUiStore } from "@/stores/admin-ui-store";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function AdminSidebar({
  className,
  forceExpanded,
}: {
  className?: string;
  forceExpanded?: boolean;
}) {
  const pathname = usePathname();
  const sidebarCollapsed = useAdminUiStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useAdminUiStore(
    (s) => s.toggleSidebarCollapsed,
  );
  const collapsed = forceExpanded ? false : sidebarCollapsed;

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 ease-out",
        collapsed ? "w-[68px]" : "w-[248px]",
        className,
      )}
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border px-2 transition-all duration-200",
          collapsed ? "justify-center" : "justify-between gap-2",
        )}
      >
        {!collapsed ? (
          <>
            <Link
              href="/admin/dashboard"
              className="flex min-w-0 flex-1 flex-col rounded-lg px-2 py-1 outline-none ring-offset-background transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate text-base font-bold tracking-tight text-foreground">
                DayLog
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Admin
              </span>
            </Link>
            {!forceExpanded ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="hidden shrink-0 lg:flex"
                onClick={() => toggleSidebarCollapsed()}
                aria-label="Collapse sidebar"
              >
                <ChevronLeft className="size-4" />
              </Button>
            ) : null}
          </>
        ) : (
          !forceExpanded && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="hidden lg:flex"
              onClick={() => toggleSidebarCollapsed()}
              aria-label="Expand sidebar"
            >
              <ChevronRight className="size-4" />
            </Button>
          )
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-4">
        <div className="flex flex-col gap-5">
          {adminNavSections.map((section) => (
            <div key={section.title}>
              {!collapsed ? (
                <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </p>
              ) : (
                <Separator className="mb-3 bg-border" />
              )}
              <ul className="flex flex-col gap-1">
                {section.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    (item.href !== "/admin/dashboard" &&
                      pathname.startsWith(`${item.href}/`));
                  const Icon = item.icon;

                  const link = (
                    <Link
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors duration-150",
                        active
                          ? "text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        collapsed && "justify-center px-0",
                      )}
                    >
                      {active ? (
                        <motion.span
                          layoutId="sidebar-active"
                          className="absolute inset-0 rounded-lg bg-muted ring-1 ring-border"
                          transition={{
                            type: "spring",
                            stiffness: 420,
                            damping: 32,
                          }}
                        />
                      ) : null}
                      <span
                        className={cn(
                          "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-md",
                          active
                            ? "text-foreground"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      >
                        <Icon className="size-[17px]" strokeWidth={1.75} />
                      </span>
                      {!collapsed ? (
                        <span className="relative z-10 truncate">
                          {item.label}
                        </span>
                      ) : null}
                    </Link>
                  );

                  if (collapsed) {
                    return (
                      <li key={item.href}>
                        <Tooltip delayDuration={0}>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right" className="font-medium">
                            {item.label}
                          </TooltipContent>
                        </Tooltip>
                      </li>
                    );
                  }

                  return <li key={item.href}>{link}</li>;
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </aside>
  );
}
