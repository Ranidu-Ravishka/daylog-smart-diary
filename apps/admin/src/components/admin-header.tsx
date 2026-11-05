"use client";

import { useAdminUiStore } from "@/stores/admin-ui-store";
import { cn } from "@/lib/utils";
import { useMounted } from "@/lib/use-mounted";
import { SignedIn, SignedOut, useClerk, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useTheme } from "next-themes";
import { Bell, Menu, Moon, Sun } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function ClerkUserMenu() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const fallback =
    user?.firstName?.trim() ||
    user?.primaryEmailAddress?.emailAddress?.trim() ||
    "User";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="gap-2 rounded-full pl-1 pr-3"
        >
          <UserAvatar
            src={user?.imageUrl}
            alt={user?.fullName || "Profile"}
            fallbackLabel={fallback}
            size="md"
          />
          <span className="hidden max-w-[120px] truncate text-xs sm:inline">
            {user?.firstName ||
              user?.primaryEmailAddress?.emailAddress ||
              "Account"}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-foreground">
              {user?.fullName || "Account"}
            </span>
            <span className="text-xs text-muted-foreground">
              {user?.primaryEmailAddress?.emailAddress}
            </span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/admin/dashboard">Dashboard</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer"
          onSelect={() => void signOut({ redirectUrl: "/sign-in" })}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AdminHeader({ className }: { className?: string }) {
  const { setTheme, resolvedTheme } = useTheme();
  const hasMounted = useMounted();
  const setMobileNavOpen = useAdminUiStore((s) => s.setMobileNavOpen);
  const isDark = hasMounted && resolvedTheme === "dark";

  return (
    <header
      className={cn(
        "sticky top-0 z-40 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/90 px-4 backdrop-blur-md",
        className,
      )}
    >
      <div className="flex min-w-0 items-center">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open navigation"
        >
          <Menu className="size-5" />
        </Button>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative"
          asChild
        >
          <Link
            href="/audit-logs"
            aria-label="Notifications and audit activity"
          >
            <Bell className="size-[18px]" strokeWidth={1.75} />
            <span className="absolute right-2 top-2 size-1.5 rounded-full bg-foreground" />
          </Link>
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() =>
            setTheme(resolvedTheme === "dark" ? "light" : "dark")
          }
          aria-label="Toggle theme"
        >
          {hasMounted ? (
            isDark ? (
              <Sun className="size-[18px]" strokeWidth={1.75} />
            ) : (
              <Moon className="size-[18px]" strokeWidth={1.75} />
            )
          ) : (
            <span aria-hidden="true" className="size-[18px]" />
          )}
        </Button>

        {!hasClerk ? (
          <Button variant="primary" size="sm" asChild>
            <Link href="/sign-in">Sign in</Link>
          </Button>
        ) : (
          <>
            <SignedOut>
              <Button variant="primary" size="sm" asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
            </SignedOut>
            <SignedIn>
              <ClerkUserMenu />
            </SignedIn>
          </>
        )}
      </div>
    </header>
  );
}
