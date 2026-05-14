"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import {
  ArrowRight,
  Brain,
  Heart,
  Layers,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { FadeIn } from "@/components/motion/fade-in";
import { HeroAmbientOrbs } from "@/components/marketing/hero-ambient-orbs";
import { DaylogContentMax } from "@repo/ui/components/daylog-content-max";
import { DaylogGlassCard } from "@repo/ui/components/daylog-glass-card";

const features = [
  {
    icon: Wand2,
    title: "Gentle AI stories",
    description:
      "Your memories, mood, and context become a warm narrative—not a task list. You stay in control of when summaries run.",
    className: "md:col-span-2",
  },
  {
    icon: Heart,
    title: "Emotionally aware",
    description:
      "Mood-aware entries help you notice patterns without judgment. The interface stays quiet when you need space.",
    className: "",
  },
  {
    icon: Layers,
    title: "One calm timeline",
    description:
      "Each day opens like a journal: notes, people, integrations, and photos in one breathable view.",
    className: "",
  },
  {
    icon: Brain,
    title: "Insights, softly",
    description:
      "Trends surface as supportive context—designed to reduce noise and cognitive load.",
    className: "md:col-span-2",
  },
] as const;

export function HomeMarketingHeroAndProduct() {
  return (
    <>
      <section className="relative overflow-hidden px-5 pb-24 pt-16 sm:px-8 sm:pb-32 sm:pt-20 md:pt-28">
        <DaylogContentMax className="relative">
          <div className="relative overflow-hidden rounded-[2rem] border border-border/50 bg-card/45 p-8 shadow-soft backdrop-blur-2xl dark:bg-card/35 sm:p-12 md:p-16">
            <HeroAmbientOrbs />
            <div className="relative z-10 mx-auto max-w-3xl text-center">
              <FadeIn>
                <p className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm">
                  <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
                  AI journaling for calmer days
                </p>
                <h1 className="text-balance text-4xl font-semibold tracking-[-0.04em] text-foreground sm:text-5xl md:text-[3.25rem] md:leading-[1.08]">
                  A softer place to remember who you were today.
                </h1>
                <p className="mx-auto mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground sm:text-xl">
                  DayLog pairs private journaling with thoughtful AI—so
                  reflection feels safe, spacious, and genuinely supportive.
                </p>
              </FadeIn>
              <FadeIn
                delay={0.08}
                className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
              >
                <SignedOut>
                  <Button
                    size="lg"
                    className="h-12 min-w-[200px] rounded-full px-8 text-base shadow-soft"
                    asChild
                  >
                    <Link href="/sign-up">
                      Begin your journal
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                </SignedOut>
                <SignedIn>
                  <Button
                    size="lg"
                    className="h-12 min-w-[200px] rounded-full px-8 text-base shadow-soft"
                    asChild
                  >
                    <Link href="/dashboard">
                      Open your space
                      <ArrowRight className="h-4 w-4" aria-hidden />
                    </Link>
                  </Button>
                </SignedIn>
                <Button
                  variant="outline"
                  size="lg"
                  className="h-12 rounded-full border-border/70 bg-background/50 px-8 text-base backdrop-blur-sm"
                  asChild
                >
                  <Link href="/#product">Explore the product</Link>
                </Button>
              </FadeIn>
            </div>

            <FadeIn
              delay={0.12}
              className="relative z-10 mx-auto mt-16 max-w-4xl"
            >
              <div className="rounded-2xl border border-border/50 bg-background/55 p-6 shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.06)] backdrop-blur-xl dark:bg-background/40 md:p-8">
                <div className="grid gap-4 md:grid-cols-5">
                  <div className="rounded-xl border border-border/40 bg-muted/30 p-4 md:col-span-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      Today
                    </p>
                    <p className="mt-1 text-sm font-medium text-foreground">
                      A quiet Tuesday
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      Walked before sunrise. The team retro felt honest, not
                      heavy.
                    </p>
                    <div className="mt-4 flex gap-1 text-primary/75">
                      {[1, 2, 3, 4, 5].map((s) => (
                        <span key={s} className="text-base" aria-hidden>
                          {s <= 4 ? "★" : "☆"}
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Day rating — optional, always yours
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/40 bg-gradient-to-br from-primary/5 via-transparent to-accent/10 p-5 md:col-span-3">
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Sparkles
                        className="h-3.5 w-3.5 text-primary"
                        aria-hidden
                      />
                      AI reflection
                    </div>
                    <p className="text-sm leading-relaxed text-muted-foreground md:text-[15px]">
                      &ldquo;You gave yourself room this morning—movement first,
                      screens second. Collaboration showed up as listening. Let
                      tonight be unhurried: you have already done enough.&rdquo;
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <span className="rounded-full border border-border/50 bg-background/60 px-3 py-1 text-[11px] text-muted-foreground">
                        4 memories
                      </span>
                      <span className="rounded-full border border-border/50 bg-background/60 px-3 py-1 text-[11px] text-muted-foreground">
                        Mood: grounded
                      </span>
                      <span className="rounded-full border border-border/50 bg-background/60 px-3 py-1 text-[11px] text-muted-foreground">
                        Integrations: optional
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </FadeIn>
          </div>
        </DaylogContentMax>
      </section>

      <section
        id="product"
        className="scroll-mt-28 border-t border-border/40 px-5 py-20 sm:px-8 sm:py-28"
      >
        <DaylogContentMax>
          <FadeIn className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Journaling that breathes with you
            </h2>
            <p className="mt-4 text-pretty text-muted-foreground sm:text-lg">
              Premium simplicity: fewer panels, more presence. Every surface is
              tuned for long reading sessions and late-night entries.
            </p>
          </FadeIn>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:gap-5">
            {features.map((f, i) => (
              <FadeIn key={f.title} delay={i * 0.05} className={f.className}>
                <DaylogGlassCard variant="feature">
                  <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border/60 bg-secondary/80 text-primary">
                    <f.icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight">
                    {f.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-[15px]">
                    {f.description}
                  </p>
                </DaylogGlassCard>
              </FadeIn>
            ))}
          </div>
        </DaylogContentMax>
      </section>
    </>
  );
}
