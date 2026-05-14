"use client";

import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { marketingNav } from "@/lib/site-nav";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MarketingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-[background,box-shadow,border-color] duration-300",
        scrolled
          ? "border-b border-border/60 bg-background/75 shadow-[0_8px_32px_-12px_hsl(0_0%_0%/0.12)] backdrop-blur-xl dark:bg-background/70 dark:shadow-[0_8px_40px_-16px_hsl(0_0%_0%/0.45)]"
          : "border-b border-transparent bg-background/40 backdrop-blur-md dark:bg-background/30",
      )}
      role="banner"
    >
      <div className="mx-auto flex h-[4.25rem] max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link
          href="/"
          className="text-[1.05rem] font-semibold tracking-[-0.03em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
        >
          DayLog
        </Link>

        <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
          {marketingNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3.5 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2 sm:flex">
          <SignedOut>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/sign-in">Sign in</Link>
            </Button>
            <Button size="sm" className="rounded-full px-5 shadow-soft" asChild>
              <Link href="/sign-up">Start journaling</Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <UserButton
              afterSignOutUrl="/"
              appearance={{
                elements: {
                  avatarBox: "h-9 w-9 ring-2 ring-border/60",
                },
              }}
            />
          </SignedIn>
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/70 bg-secondary/80 text-foreground shadow-sm backdrop-blur-sm lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls="mobile-marketing-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open ? (
        <div
          id="mobile-marketing-nav"
          className="border-t border-border/60 bg-background/95 backdrop-blur-xl lg:hidden"
        >
          <nav
            className="mx-auto flex max-w-6xl flex-col gap-1 px-5 py-4 sm:px-8"
            aria-label="Mobile primary"
          >
            {marketingNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-xl px-3 py-3 text-sm font-medium text-foreground hover:bg-muted/80"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-4">
              <SignedOut>
                <Button variant="outline" asChild className="w-full rounded-xl">
                  <Link href="/sign-in" onClick={() => setOpen(false)}>
                    Sign in
                  </Link>
                </Button>
                <Button asChild className="w-full rounded-xl">
                  <Link href="/sign-up" onClick={() => setOpen(false)}>
                    Start journaling
                  </Link>
                </Button>
              </SignedOut>
              <SignedIn>
                <Button asChild className="w-full rounded-xl">
                  <Link href="/dashboard" onClick={() => setOpen(false)}>
                    Dashboard
                  </Link>
                </Button>
              </SignedIn>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
