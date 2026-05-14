import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";

type MarketingInnerLayoutProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
};

export function MarketingInnerLayout({
  title,
  subtitle,
  children,
}: MarketingInnerLayoutProps) {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
      <FadeIn>
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back home
        </Link>
        <h1 className="mt-8 text-4xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground text-pretty">
            {subtitle}
          </p>
        ) : null}
      </FadeIn>
      <div className="mt-12 space-y-8 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
        {children}
      </div>
    </main>
  );
}
