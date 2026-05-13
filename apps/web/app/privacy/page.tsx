import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="text-sm text-muted-foreground mb-4">
          Last updated: March 25, 2026
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance mb-8">
          Privacy Policy
        </h1>

        <div className="space-y-8 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              What we collect
            </h2>
            <p>
              DayLog collects account information you provide through
              authentication, memories you write, and reflection preferences
              required to operate the app.
            </p>
            <p>
              DayLog can collect optional foreground location signals only when
              you explicitly enable location tracking in mobile settings and
              keep the app open. DayLog does not collect background location
              traces or call-log data.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              How we use data
            </h2>
            <p>
              We use your data to provide daily reflection features, generate
              summaries, and operate integrations you explicitly connect.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Data sharing
            </h2>
            <p>
              We do not sell your personal data. Data is shared only with
              service providers necessary to run DayLog features (for example,
              authentication and infrastructure).
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">
              Data control
            </h2>
            <p>
              You can export your data from the app and request account deletion
              from account settings.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Contact</h2>
            <p>
              For privacy questions, contact{" "}
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
