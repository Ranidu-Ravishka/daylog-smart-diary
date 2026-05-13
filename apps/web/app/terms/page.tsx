import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export default function TermsPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="text-sm text-muted-foreground mb-4">
          Last updated: March 25, 2026
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance mb-8">
          Terms of Service
        </h1>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Use of DayLog
            </h2>
            <p>
              You may use DayLog for personal reflection and journaling. You are
              responsible for the content you create and connect through
              integrations.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Account security
            </h2>
            <p>
              You are responsible for maintaining account security and for
              activity that occurs under your account.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Service availability
            </h2>
            <p>
              DayLog is provided on an &quot;as available&quot; basis. Features
              may change as the product evolves.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Termination
            </h2>
            <p>
              You can stop using the service at any time and may delete your
              account from settings.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Contact</h2>
            <p>
              For terms questions, contact{" "}
              <a
                href="mailto:hello@daylog.app"
                className="font-medium text-foreground underline underline-offset-4"
              >
                hello@daylog.app
              </a>
              .
            </p>
          </section>
        </div>

        <div className="mt-12 border-t border-border/60 pt-8">
          <Link
            href="/"
            className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            Back to home
          </Link>
        </div>
      </article>
    </MarketingShell>
  );
}
