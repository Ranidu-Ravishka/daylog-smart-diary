import Link from "next/link";
import { SignedIn, SignedOut, UserButton } from "@clerk/nextjs";
import {
  Sparkles,
  Camera,
  BarChart3,
  Shield,
  ArrowRight,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const features = [
  {
    icon: Sparkles,
    title: "AI-Powered Summaries",
    description:
      "Generate a daily narrative from your memories, mood, day notes, and any connected integration context.",
  },
  {
    icon: Camera,
    title: "Memory Capture",
    description:
      "Capture moments with notes and mood tags. Build a personal timeline you can revisit anytime.",
  },
  {
    icon: BarChart3,
    title: "Insights & Trends",
    description:
      "Discover patterns in your mood and journaling habits with practical daily and weekly insights.",
  },
  {
    icon: Shield,
    title: "Private & Secure",
    description:
      "Your data stays yours. Secure authentication and end-to-end privacy. We never sell your data.",
  },
];

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* ── Navbar ─────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <span className="text-lg font-semibold tracking-tight">DayLog</span>
          <div className="flex items-center gap-2">
            <SignedOut>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/sign-in">Sign in</Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/sign-up">Get started</Link>
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
                    avatarBox: "h-8 w-8",
                  },
                }}
              />
            </SignedIn>
          </div>
        </div>
      </nav>

      {/* ── Hero ──────────────────────────────────────── */}
      <section className="flex flex-1 flex-col items-center px-6 pt-24 pb-20 md:pt-36 md:pb-28 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground mb-8">
          <Sparkles className="h-3 w-3" />
          AI-Powered Daily Reflection
        </div>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl">
          Your day, beautifully remembered.
        </h1>
        <p className="mt-6 max-w-lg text-lg text-muted-foreground leading-relaxed">
          Capture moments, track your mood, and get AI&#8209;generated stories.
          Build a meaningful reflection habit in minutes.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <SignedOut>
            <Button size="lg" asChild>
              <Link href="/sign-up">
                Start for free
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button size="lg" asChild>
              <Link href="/dashboard">
                Go to dashboard
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </SignedIn>
          <Button variant="outline" size="lg" asChild>
            <a href="#features">
              Learn more
              <ChevronDown className="ml-1 h-4 w-4" />
            </a>
          </Button>
        </div>

        {/* ── App Preview ────────────────────────────── */}
        <div className="mt-20 w-full max-w-3xl">
          <div className="rounded-lg border bg-card p-6 shadow-sm md:p-10">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-md border p-4">
                <p className="text-xs text-muted-foreground">Today</p>
                <p className="mt-1 text-sm font-medium">Monday, Mar 9</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Feeling happy
                </p>
                <div className="mt-2 flex gap-0.5 text-sm text-muted-foreground">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <span
                      key={s}
                      className={s <= 4 ? "text-foreground" : "text-border"}
                    >
                      ★
                    </span>
                  ))}
                </div>
              </div>
              <div className="rounded-md border p-4 md:col-span-2">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  AI Summary
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  &ldquo;You started the morning with a peaceful walk — a great
                  way to begin the week. The team meeting went well, and you
                  felt productive. Highlights: finished the proposal and had
                  dinner with friends.&rdquo;
                </p>
                <div className="mt-3 flex gap-2">
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    3 memories
                  </span>
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    2 highlights
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────── */}
      <section id="features" className="border-t px-6 py-24 md:py-32">
        <div className="mx-auto max-w-5xl">
          <div className="mb-16 text-center">
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
              Everything you need to reflect
            </h2>
            <p className="mt-4 text-muted-foreground">
              A simple yet powerful toolkit for daily journaling and
              self&#8209;discovery.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {features.map((f) => (
              <div
                key={f.title}
                className="group rounded-lg border p-6 transition-colors hover:bg-muted/50"
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-md border">
                  <f.icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground transition-colors" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ───────────────────────────────────────── */}
      <section className="border-t px-6 py-24 md:py-32">
        <div className="mx-auto max-w-xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Start reflecting today
          </h2>
          <p className="mt-4 text-muted-foreground">
            Build a daily journaling habit. It takes less than 2&nbsp;minutes a
            day.
          </p>
          <SignedOut>
            <Button size="lg" className="mt-8" asChild>
              <Link href="/sign-up">
                Create your free account
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </SignedOut>
          <SignedIn>
            <Button size="lg" className="mt-8" asChild>
              <Link href="/dashboard">
                Go to dashboard
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </SignedIn>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────── */}
      <footer className="border-t px-6 py-12">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col gap-8 md:flex-row md:justify-between">
            <div>
              <span className="text-sm font-semibold">DayLog</span>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                AI-powered daily reflection. Capture moments, discover patterns,
                and build a meaningful habit.
              </p>
            </div>
            <div className="flex gap-12">
              <div>
                <p className="text-sm font-medium mb-3">Legal</p>
                <ul className="space-y-2">
                  <li>
                    <Link
                      href="/privacy"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Privacy Policy
                    </Link>
                  </li>
                  <li>
                    <Link
                      href="/terms"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Terms of Service
                    </Link>
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-sm font-medium mb-3">Contact</p>
                <p className="text-sm text-muted-foreground">
                  hello@daylog.app
                </p>
              </div>
            </div>
          </div>
          <div className="mt-10 border-t pt-6 text-center">
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} DayLog. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
