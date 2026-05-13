import { MarketingShell } from "@/components/marketing/marketing-shell";
import { MarketingInnerLayout } from "@/components/marketing/marketing-inner-layout";

export default function AboutPage() {
  return (
    <MarketingShell>
      <MarketingInnerLayout
        title="About DayLog"
        subtitle="We believe reflection should feel emotionally safe—never like another inbox."
      >
        <section className="space-y-4 text-pretty">
          <h2 className="text-base font-semibold text-foreground">Mission</h2>
          <p>
            DayLog exists to help people notice their lives with gentleness. We
            combine private journaling with AI that amplifies clarity instead of
            urgency.
          </p>
          <p>
            The product is shaped around low cognitive load: generous spacing,
            quiet typography, and motion that respects your nervous system.
          </p>
        </section>
        <section className="space-y-4 text-pretty">
          <h2 className="text-base font-semibold text-foreground">
            Principles
          </h2>
          <ul className="list-inside list-disc space-y-2 marker:text-primary">
            <li>Privacy and control are non-negotiable defaults.</li>
            <li>AI should read as compassionate, never coercive.</li>
            <li>Your pace is the right pace—streaks optional, shame never.</li>
          </ul>
        </section>
      </MarketingInnerLayout>
    </MarketingShell>
  );
}
