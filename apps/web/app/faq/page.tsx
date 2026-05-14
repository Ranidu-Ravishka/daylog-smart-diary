import { MarketingShell } from "@/components/marketing/marketing-shell";
import { MarketingInnerLayout } from "@/components/marketing/marketing-inner-layout";
import { FadeIn } from "@/components/motion/fade-in";

const items = [
  {
    q: "Is DayLog therapy?",
    a: "No. DayLog is a journaling product. If you are in crisis, please reach out to local emergency services or a licensed professional.",
  },
  {
    q: "Can I use DayLog without AI?",
    a: "Yes. Summaries are generated only when you choose to run them. Your memories and notes work fully without AI.",
  },
  {
    q: "How does sync work between mobile and web?",
    a: "Your account is the source of truth. Entries and preferences propagate through Convex in near realtime when you are online.",
  },
  {
    q: "Can I export my data?",
    a: "Yes. Signed exports are available from the web dashboard, with optional inclusion of coarse location signals.",
  },
  {
    q: "What happens if I delete my account?",
    a: "Account deletion runs a structured cleanup job, then finalizes sign-in removal. Keep the account page open until the flow completes.",
  },
];

export default function FaqPage() {
  return (
    <MarketingShell>
      <MarketingInnerLayout
        title="Frequently asked questions"
        subtitle="Straight answers—no marketing fog."
      >
        <div className="space-y-3">
          {items.map((item, i) => (
            <FadeIn key={item.q} delay={i * 0.03}>
              <details className="group rounded-2xl border border-border/50 bg-card/40 px-5 py-4 backdrop-blur-md open:shadow-sm dark:bg-card/30">
                <summary className="cursor-pointer list-none text-sm font-semibold text-foreground outline-none transition-colors marker:content-none [&::-webkit-details-marker]:hidden">
                  <span className="flex items-center justify-between gap-3">
                    {item.q}
                    <span className="text-muted-foreground transition-transform group-open:rotate-180">
                      ▼
                    </span>
                  </span>
                </summary>
                <p className="mt-3 border-t border-border/40 pt-3 text-sm leading-relaxed text-muted-foreground">
                  {item.a}
                </p>
              </details>
            </FadeIn>
          ))}
        </div>
      </MarketingInnerLayout>
    </MarketingShell>
  );
}
