import Link from "next/link";
import { MarketingShell } from "@/components/marketing/marketing-shell";
import { MarketingInnerLayout } from "@/components/marketing/marketing-inner-layout";

export default function ContactPage() {
  return (
    <MarketingShell>
      <MarketingInnerLayout
        title="Contact"
        subtitle="We read every message. For privacy-specific questions, mention it in the subject line."
      >
        <p>
          Email us at{" "}
          <a
            href="mailto:hello@daylog.app"
            className="font-medium text-foreground underline underline-offset-4"
          >
            hello@daylog.app
          </a>
          .
        </p>
        <p>
          For legal and data requests, see our{" "}
          <Link
            href="/privacy"
            className="font-medium text-foreground underline underline-offset-4"
          >
            Privacy Policy
          </Link>{" "}
          for the right contact path and timelines.
        </p>
      </MarketingInnerLayout>
    </MarketingShell>
  );
}
