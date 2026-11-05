"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { CalendarDays, Download, Home, Settings, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/dashboard", label: "Journal", icon: CalendarDays },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
  { href: "/dashboard/export", label: "Export", icon: Download },
  { href: "/dashboard/account", label: "Account", icon: User },
] as const;

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-background">
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_10%_-10%,hsl(var(--glow-1)/0.22),transparent_55%),radial-gradient(900px_500px_at_90%_0%,hsl(var(--glow-2)/0.18),transparent_50%),radial-gradient(800px_480px_at_50%_100%,hsl(var(--glow-3)/0.14),transparent_55%)] dark:opacity-80" />
        <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/25" />
      </div>

      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-3 sm:px-4 md:px-6 lg:px-8">
          <div className="flex items-center gap-2 sm:gap-3">
            <Link
              href="/"
              className="hidden rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex"
              aria-label="DayLog marketing home"
            >
              <Home className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard"
              className="rounded-md px-1 py-1 text-[15px] font-semibold tracking-[-0.03em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              DayLog
            </Link>
          </div>

          <UserButton
            afterSignOutUrl="/"
            appearance={{
              elements: {
                avatarBox: "h-8 w-8 ring-2 ring-border/60",
              },
            }}
          />
        </div>
      </header>

      <div className="mx-auto flex min-h-[calc(100vh-3.5rem)] max-w-7xl flex-col px-0 md:flex-row md:gap-5 md:px-4 md:pb-8 md:pt-6 lg:gap-6 lg:px-6">
        <aside className="hidden shrink-0 md:block md:w-52 lg:w-56 xl:w-60">
          <nav
            className="sticky top-24 space-y-1 rounded-2xl border border-border/50 bg-card/50 p-2 shadow-sm backdrop-blur-md dark:bg-card/40"
            aria-label="Dashboard"
          >
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Button
                  key={item.href}
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-11 w-full justify-start gap-2.5 rounded-xl px-3 font-medium text-muted-foreground",
                    isActive &&
                      "bg-primary/10 text-foreground shadow-none dark:bg-primary/15",
                  )}
                  asChild
                >
                  <Link href={item.href}>
                    <item.icon className="h-4 w-4 shrink-0 opacity-80" />
                    {item.label}
                  </Link>
                </Button>
              );
            })}
          </nav>
        </aside>

        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-border/60 bg-background/90 px-1 py-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] backdrop-blur-xl md:hidden">
          <nav
            className="mx-auto flex max-w-md justify-around gap-1"
            aria-label="Dashboard mobile"
          >
            {navItems.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex min-w-[4.25rem] flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl border transition-colors",
                      isActive
                        ? "border-primary/35 bg-primary/10 text-primary"
                        : "border-transparent bg-muted/40",
                    )}
                  >
                    <item.icon className="h-4 w-4" />
                  </span>
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <main className="relative flex-1 px-3 pb-28 pt-4 sm:px-5 sm:pb-8 md:px-2 lg:rounded-[1.75rem] lg:border lg:border-border/50 lg:bg-card/35 lg:px-8 lg:py-8 lg:shadow-soft lg:backdrop-blur-md dark:lg:bg-card/25">
          {children}
        </main>
      </div>
    </div>
  );
}
