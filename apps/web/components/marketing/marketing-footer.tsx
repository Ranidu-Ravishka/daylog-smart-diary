import Link from "next/link";
import { Sparkles } from "lucide-react";

const footerLinks = [
  {
    title: "Product",
    items: [
      { href: "/#product", label: "Overview" },
      { href: "/#how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Company",
    items: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact" },
      { href: "/developers", label: "Developers" },
    ],
  },
  {
    title: "Legal",
    items: [
      { href: "/privacy", label: "Privacy" },
      { href: "/terms", label: "Terms" },
    ],
  },
] as const;

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/60 bg-muted/20">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-1">
            <div className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="h-4 w-4" aria-hidden />
              </span>
              DayLog
            </div>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-muted-foreground">
              A calm place for daily reflection—private journaling with gentle
              AI that helps you see patterns, not pressure.
            </p>
          </div>
          {footerLinks.map((group) => (
            <div key={group.title}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group.title}
              </p>
              <ul className="mt-4 space-y-3">
                {group.items.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-foreground/80 transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-14 flex flex-col items-center justify-between gap-4 border-t border-border/50 pt-8 text-center text-xs text-muted-foreground sm:flex-row sm:text-left">
          <p>
            © {new Date().getFullYear()} DayLog. Crafted for mindful
            journaling.
          </p>
          <a
            href="mailto:hello@daylog.app"
            className="font-medium text-foreground/90 underline-offset-4 hover:underline"
          >
            hello@daylog.app
          </a>
        </div>
      </div>
    </footer>
  );
}
