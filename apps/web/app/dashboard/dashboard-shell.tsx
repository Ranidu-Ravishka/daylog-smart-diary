"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { CalendarDays, Settings, Download, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Summary", icon: CalendarDays },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/dashboard/export", label: "Export", icon: Download },
  { href: "/dashboard/account", label: "Account", icon: User },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top bar ───────────────────────────────────── */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            DayLog
          </Link>
          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: { avatarBox: "h-7 w-7" },
            }}
          />
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl">
        {/* ── Sidebar (desktop) ───────────────────────── */}
        <aside className="hidden md:flex w-52 shrink-0 flex-col border-r py-6 px-3 min-h-[calc(100vh-3.5rem)]">
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Button
                  key={item.href}
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "justify-start gap-2",
                    isActive && "font-medium",
                  )}
                  asChild
                >
                  <Link href={item.href}>
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        </aside>

        {/* ── Mobile nav ──────────────────────────────── */}
        <div className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t bg-background px-2 py-1.5">
          <div className="flex justify-around">
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-0.5 px-3 py-1 text-[10px]",
                    isActive
                      ? "text-foreground font-medium"
                      : "text-muted-foreground",
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* ── Main ────────────────────────────────────── */}
        <main className="flex-1 min-h-[calc(100vh-3.5rem)] px-6 py-8 pb-24 md:px-10 md:pb-8">
          {children}
        </main>
      </div>
    </div>
  );
}
