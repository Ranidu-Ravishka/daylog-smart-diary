import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12 md:py-16">
      <p className="text-sm text-muted-foreground mb-4">
        Last updated: March 25, 2026
      </p>
      <h1 className="text-3xl font-bold tracking-tight mb-6">Privacy Policy</h1>

      <div className="space-y-6 text-sm leading-6 text-muted-foreground">
        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            What we collect
          </h2>
          <p>
            DayLog collects account information you provide through
            authentication, memories you write, and reflection preferences
            required to operate the app.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            How we use data
          </h2>
          <p>
            We use your data to provide daily reflection features, generate
            summaries, and operate integrations you explicitly connect.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Data sharing
          </h2>
          <p>
            We do not sell your personal data. Data is shared only with service
            providers necessary to run DayLog features (for example,
            authentication and infrastructure).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">
            Data control
          </h2>
          <p>
            You can export your data from the app and request account deletion
            from account settings.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold text-foreground">Contact</h2>
          <p>
            For privacy questions, contact{" "}
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
