import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { Check } from "lucide-react";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { FadeIn } from "@/components/motion/fade-in";
import { Button } from "@/components/ui/button";

const tiers = [
  {
    name: "Reflect",
    price: "Free",
    description: "Private journaling with core AI summaries.",
    features: [
      "Daily memories & mood",
      "Manual summary generation",
      "Web dashboard access",
    ],
    cta: "Start free",
    href: "/sign-up",
    highlighted: false,
  },
  {
    name: "Presence",
    price: "Coming soon",
    description:
      "Deeper insights and priority generation—designed for power reflectors.",
    features: [
      "Everything in Reflect",
      "Advanced insight views",
      "Higher media limits",
      "Priority support",
    ],
    cta: "Join the waitlist",
    href: "/contact",
    highlighted: true,
  },
  {
    name: "Teams",
    price: "Custom",
    description: "For organizations building reflective culture at scale.",
    features: ["Security review", "Custom retention", "Dedicated onboarding"],
    cta: "Talk to us",
    href: "/contact",
    highlighted: false,
  },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <FadeIn className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Pricing that stays human
          </h1>
          <p className="mt-4 text-pretty text-lg text-muted-foreground">
            Start free. Upgrade only when DayLog becomes a daily anchor in your
            life.
          </p>
        </FadeIn>
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          {tiers.map((tier, i) => (
            <FadeIn key={tier.name} delay={i * 0.05}>
              <div
                className={`flex h-full flex-col rounded-2xl border p-8 shadow-sm backdrop-blur-md transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:shadow-soft ${
                  tier.highlighted
                    ? "border-primary/40 bg-gradient-to-b from-primary/10 via-card/60 to-card/50 dark:from-primary/15 dark:via-card/40"
                    : "border-border/50 bg-card/45 dark:bg-card/35"
                }`}
              >
                <h2 className="text-lg font-semibold">{tier.name}</h2>
                <p className="mt-2 text-3xl font-semibold tracking-tight">
                  {tier.price}
                </p>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {tier.description}
                </p>
                <ul className="mt-6 flex-1 space-y-3 text-sm text-muted-foreground">
                  {tier.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                        aria-hidden
                      />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-8">
                  {tier.href === "/sign-up" ? (
                    <>
                      <SignedOut>
                        <Button className="w-full rounded-full" asChild>
                          <Link href="/sign-up">{tier.cta}</Link>
                        </Button>
                      </SignedOut>
                      <SignedIn>
                        <Button className="w-full rounded-full" asChild>
                          <Link href="/dashboard">Go to dashboard</Link>
                        </Button>
                      </SignedIn>
                    </>
                  ) : (
                    <Button
                      variant={tier.highlighted ? "default" : "outline"}
                      className="w-full rounded-full"
                      asChild
                    >
                      <Link href={tier.href}>{tier.cta}</Link>
                    </Button>
                  )}
                </div>
              </div>
            </FadeIn>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
