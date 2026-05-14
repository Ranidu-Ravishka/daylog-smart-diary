"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import {
  ArrowRight,
  Lock,
  MessageCircle,
  Moon,
  Shield,
  Smartphone,
  Sparkles,
  SunMedium,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion/fade-in";
import { cn } from "@/lib/utils";
import { DaylogContentMax } from "@repo/ui/components/daylog-content-max";
import {
  DaylogGlassCard,
  daylogGlassSurfaces,
} from "@repo/ui/components/daylog-glass-card";

const steps = [
  {
    step: "01",
    title: "Capture a moment",
    body: "A line or a paragraph—whatever feels right. Add mood and time in a few taps.",
  },
  {
    step: "02",
    title: "Enrich your day",
    body: "Optional integrations add context. You choose what connects and what stays off.",
  },
  {
    step: "03",
    title: "Reflect with AI",
    body: "When you are ready, generate a summary that reads like a compassionate recap—not a report.",
  },
] as const;

const testimonials = [
  {
    quote:
      "It feels like a wellness product for my brain. I open DayLog when I need to land after a chaotic day.",
    name: "Maya R.",
    role: "Product designer",
  },
  {
    quote:
      "The AI summary is surprisingly tender. I actually read it instead of skimming bullet points.",
    name: "Jordan L.",
    role: "Engineering lead",
  },
  {
    quote:
      "Dark mode + spacing + no clutter. Finally a journal app that does not shout at me.",
    name: "Sam K.",
    role: "Therapist in training",
  },
] as const;

const faqPreview = [
  {
    q: "Who can read my entries?",
    a: "Your account is private. Summaries are generated for you and stored under the same protections as the rest of your data.",
  },
  {
    q: "Do I need to write every day?",
    a: "No. DayLog is built for gentle consistency—some days are full, some are a single sentence. Both are valid.",
  },
] as const;

export function HomeMarketingBelowFold() {
  return (
    <>
      <section className="border-t border-border/40 bg-muted/15 px-5 py-20 sm:px-8 sm:py-28">
        <DaylogContentMax className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
          <FadeIn>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              AI insights that feel like a conversation
            </h2>
            <p className="mt-4 text-pretty text-muted-foreground sm:text-lg">
              Summaries weave mood, memories, and the texture of your day. The
              goal is recognition—not optimization pressure.
            </p>
            <ul className="mt-8 space-y-4 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <Zap
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-hidden
                />
                On-demand generation keeps you in charge of when AI steps in.
              </li>
              <li className="flex gap-3">
                <Shield
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-hidden
                />
                Clear sourcing cues show what informed each story.
              </li>
              <li className="flex gap-3">
                <MessageCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                  aria-hidden
                />
                Tone stays grounded: supportive language, no toxic positivity.
              </li>
            </ul>
          </FadeIn>
          <FadeIn delay={0.06}>
            <DaylogGlassCard variant="marketing">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Sample insight block
              </p>
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                This week, your evenings cluster around creative work. Mornings
                skew lighter—maybe protect one slow start this weekend?
              </p>
              <div className="mt-6 grid grid-cols-3 gap-3 text-center">
                <div className="rounded-xl border border-border/40 bg-background/50 py-4">
                  <p className="text-2xl font-semibold tabular-nums">12</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    entries
                  </p>
                </div>
                <div className="rounded-xl border border-border/40 bg-background/50 py-4">
                  <p className="text-2xl font-semibold tabular-nums">4</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    calm days
                  </p>
                </div>
                <div className="rounded-xl border border-border/40 bg-background/50 py-4">
                  <p className="text-2xl font-semibold tabular-nums">86%</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    presence
                  </p>
                </div>
              </div>
              <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/90">
                Illustrative metrics only—your dashboard shows real data tied to
                your account.
              </p>
            </DaylogGlassCard>
          </FadeIn>
        </DaylogContentMax>
      </section>

      <section
        id="how-it-works"
        className="scroll-mt-28 border-t border-border/40 px-5 py-20 sm:px-8 sm:py-28"
      >
        <DaylogContentMax>
          <FadeIn className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              How DayLog fits into real life
            </h2>
            <p className="mt-4 text-muted-foreground sm:text-lg">
              Three gentle steps—no streak anxiety, no guilt if you skip a day.
            </p>
          </FadeIn>
          <ol className="mt-14 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <FadeIn key={s.step} delay={i * 0.06}>
                <li className="relative h-full rounded-2xl border border-border/50 bg-background/50 p-6 backdrop-blur-sm dark:bg-background/35">
                  <span className="text-xs font-semibold text-primary">
                    {s.step}
                  </span>
                  <h3 className="mt-3 text-lg font-semibold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                </li>
              </FadeIn>
            ))}
          </ol>
        </DaylogContentMax>
      </section>

      <section className="border-t border-border/40 px-5 py-20 sm:px-8 sm:py-28">
        <DaylogContentMax>
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <FadeIn>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Mobile capture. Web depth.
              </h2>
              <p className="mt-4 text-pretty text-muted-foreground sm:text-lg">
                Jot on the go, then settle in on the web for longer reflection,
                exports, and settings. Everything stays synced through your
                secure account.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-2 text-xs font-medium backdrop-blur-sm">
                  <Smartphone className="h-3.5 w-3.5" aria-hidden />
                  Mobile app
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-2 text-xs font-medium backdrop-blur-sm">
                  <SunMedium className="h-3.5 w-3.5" aria-hidden />
                  Web dashboard
                </span>
                <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-2 text-xs font-medium backdrop-blur-sm">
                  <Moon className="h-3.5 w-3.5" aria-hidden />
                  Restful dark mode
                </span>
              </div>
            </FadeIn>
            <FadeIn delay={0.06}>
              <div className="rounded-2xl border border-border/50 bg-gradient-to-br from-muted/40 via-card/40 to-transparent p-8 shadow-inner backdrop-blur-md">
                <p className="text-sm italic leading-relaxed text-muted-foreground">
                  &ldquo;Some weeks I only write twice. DayLog never makes me
                  feel behind—it meets me where I am.&rdquo;
                </p>
                <p className="mt-4 text-xs font-medium text-foreground">
                  Daily reflection, without the pressure of daily performance.
                </p>
              </div>
            </FadeIn>
          </div>
        </DaylogContentMax>
      </section>

      <section className="border-t border-border/40 bg-muted/15 px-5 py-20 sm:px-8 sm:py-28">
        <DaylogContentMax>
          <FadeIn className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Voices from calmer corners
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">
              Composite feedback styled as testimonials for launch storytelling.
            </p>
          </FadeIn>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {testimonials.map((t, i) => (
              <FadeIn key={t.name} delay={i * 0.05}>
                <blockquote className={cn(daylogGlassSurfaces.quote)}>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    &ldquo;{t.quote}&rdquo;
                  </p>
                  <footer className="mt-5 text-xs font-medium text-foreground">
                    {t.name}
                    <span className="block font-normal text-muted-foreground">
                      {t.role}
                    </span>
                  </footer>
                </blockquote>
              </FadeIn>
            ))}
          </div>
        </DaylogContentMax>
      </section>

      <section
        id="security"
        className="scroll-mt-28 border-t border-border/40 px-5 py-20 sm:px-8 sm:py-28"
      >
        <DaylogContentMax>
          <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
            <FadeIn>
              <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-secondary/80 text-primary">
                <Lock className="h-5 w-5" aria-hidden />
              </div>
              <h2 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">
                Privacy-first by design
              </h2>
              <p className="mt-4 text-pretty text-muted-foreground sm:text-lg">
                Authentication protects your account. You control integrations,
                exports, and deletion flows. We never sell your memories.
              </p>
              <Button variant="outline" className="mt-8 rounded-full" asChild>
                <Link href="/privacy">Read the privacy policy</Link>
              </Button>
            </FadeIn>
            <FadeIn delay={0.06}>
              <ul className="space-y-4 rounded-2xl border border-border/50 bg-card/45 p-8 text-sm text-muted-foreground shadow-sm backdrop-blur-md dark:bg-card/35">
                <li className="flex gap-3">
                  <Shield
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  Secure sign-in and session management via Clerk.
                </li>
                <li className="flex gap-3">
                  <Sparkles
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  AI runs on your data only to deliver in-product features you
                  trigger.
                </li>
                <li className="flex gap-3">
                  <Smartphone
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-hidden
                  />
                  Location signals stay coarse, opt-in, and transparent—see
                  settings for details.
                </li>
              </ul>
            </FadeIn>
          </div>
        </DaylogContentMax>
      </section>

      <section className="border-t border-border/40 px-5 py-20 sm:px-8 sm:py-28">
        <DaylogContentMax>
          <FadeIn className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Questions, answered quietly
            </h2>
          </FadeIn>
          <div className="mx-auto mt-10 max-w-2xl space-y-4">
            {faqPreview.map((item, i) => (
              <FadeIn key={item.q} delay={i * 0.04}>
                <div className="rounded-2xl border border-border/50 bg-card/40 p-5 backdrop-blur-md dark:bg-card/30">
                  <h3 className="text-sm font-semibold text-foreground">
                    {item.q}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.a}
                  </p>
                </div>
              </FadeIn>
            ))}
          </div>
          <FadeIn className="mt-8 text-center">
            <Button variant="ghost" className="rounded-full" asChild>
              <Link href="/faq">View all FAQs</Link>
            </Button>
          </FadeIn>
        </DaylogContentMax>
      </section>

      <section className="border-t border-border/40 bg-muted/15 px-5 py-20 sm:px-8 sm:py-28">
        <div className="mx-auto max-w-3xl rounded-[2rem] border border-border/50 bg-gradient-to-br from-card/80 via-card/50 to-transparent p-10 text-center shadow-soft backdrop-blur-xl dark:from-card/50 dark:via-card/35 sm:p-14">
          <FadeIn>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Ready for a kinder daily ritual?
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-pretty text-muted-foreground sm:text-lg">
              Start on the web in minutes. Write a line or a page—DayLog holds
              it with care.
            </p>
            <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <SignedOut>
                <Button
                  size="lg"
                  className="h-12 min-w-[220px] rounded-full px-8 text-base shadow-soft"
                  asChild
                >
                  <Link href="/sign-up">
                    Create your space
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </SignedOut>
              <SignedIn>
                <Button
                  size="lg"
                  className="h-12 min-w-[220px] rounded-full px-8 text-base shadow-soft"
                  asChild
                >
                  <Link href="/dashboard">
                    Continue journaling
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Link>
                </Button>
              </SignedIn>
              <Button
                variant="outline"
                size="lg"
                className="h-12 rounded-full px-8"
                asChild
              >
                <Link href="/pricing">View pricing</Link>
              </Button>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              Prefer mobile? Use the DayLog app for capture—your entries sync to
              this web experience.
            </p>
          </FadeIn>
        </div>
      </section>
    </>
  );
}
