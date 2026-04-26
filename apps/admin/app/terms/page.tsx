import { PageContent, PageHeader, PageLayout } from "@/components/page-layout";

export default function TermsPage() {
  return (
    <PageLayout className="max-w-2xl">
      <PageHeader
        title="Terms"
        description="Use of the DayLog administration console."
      />
      <PageContent>
        <p className="text-sm text-muted-foreground">
          Access to this console is restricted to authorized operators. Use
          production data only as permitted by your organization. For
          contractual terms, refer to your agreement with DayLog or your
          employer.
        </p>
      </PageContent>
    </PageLayout>
  );
}
