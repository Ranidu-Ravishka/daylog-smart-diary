import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
      <p className="text-sm text-muted-foreground mb-4">
        Last updated: March 25, 2026
      </p>
      <h1 className="text-3xl font-bold tracking-tight mb-6">
        Terms of Service
      </h1>

      <div className="space-y-6 text-sm leading-6 text-muted-foreground">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Use of DayLog
          </h2>
          <p>
            You may use DayLog for personal reflection and journaling. You are
            responsible for the content you create and connect through
            integrations.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Account security
          </h2>
          <p>
            You are responsible for maintaining account security and for
            activity that occurs under your account.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Service availability
          </h2>
          <p>
            DayLog is provided on an &quot;as available&quot; basis. Features
            may change as the product evolves.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Termination
          </h2>
          <p>
            You can stop using the service at any time and may delete your
            account from settings.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">Contact</h2>
          <p>
            For terms questions, contact{" "}
            <a
              href="mailto:hello@daylog.app"
              className="text-foreground underline underline-offset-4"
            >
              hello@daylog.app
            </a>
            .
          </p>
        </section>
      </div>

      <div className="mt-10 pt-6 border-t">
        <Link
          href="/"
          className="text-sm font-medium underline underline-offset-4"
        >
          Back to Home
        </Link>
      </div>
    </main>
  );
}
