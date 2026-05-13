import { MarketingShell } from "@/components/marketing/marketing-shell";
import { MarketingInnerLayout } from "@/components/marketing/marketing-inner-layout";

export default function DevelopersPage() {
  return (
    <MarketingShell>
      <MarketingInnerLayout
        title="Developer details"
        subtitle="A quick technical snapshot for engineers evaluating DayLog."
      >
        <section className="space-y-4 text-pretty">
          <h2 className="text-base font-semibold text-foreground">Stack</h2>
          <p>
            DayLog is a modern TypeScript monorepo: Next.js for the web client,
            Convex for realtime data and functions, and Clerk for
            authentication. Mobile clients share backend contracts with the web
            dashboard.
          </p>
        </section>
        <section className="space-y-4 text-pretty">
          <h2 className="text-base font-semibold text-foreground">
            Integrations
          </h2>
          <p>
            OAuth-connected providers sync on your schedule. Tokens and sync
            metadata are handled with least-privilege patterns—see in-app
            settings for provider-specific notes.
          </p>
        </section>
        <section className="space-y-4 text-pretty">
          <h2 className="text-base font-semibold text-foreground">
            Observability
          </h2>
          <p>
            The web app includes structured logging hooks for critical flows
            (summaries, integrations, exports) so issues can be traced without
            exposing journal content in logs.
          </p>
        </section>
      </MarketingInnerLayout>
    </MarketingShell>
  );
}
