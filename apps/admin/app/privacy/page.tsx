import { PageContent, PageHeader, PageLayout } from "@/components/page-layout";

export default function PrivacyPage() {
  return (
    <PageLayout className="max-w-2xl">
      <PageHeader
        title="Privacy"
        description="Data handling for the DayLog admin console."
      />
      <PageContent>
        <p className="text-sm text-muted-foreground">
          This internal tool processes data according to your organization’s
          policies. For the full privacy statement applicable to your
          deployment, contact your administrator or legal team.
        </p>
      </PageContent>
    </PageLayout>
  );
}
