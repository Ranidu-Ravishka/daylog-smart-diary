import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { PageContent, PageHeader, PageLayout } from "@/components/page-layout";

type PageContainerProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function PageContainer({
  title,
  description,
  action,
  children,
  className,
}: PageContainerProps) {
  return (
    <PageLayout className={className}>
      <PageHeader title={title} description={description} actions={action} />
      <PageContent>{children}</PageContent>
    </PageLayout>
  );
}

/** Full-width pages (e.g. wide tables) */
export function PageContainerWide({
  title,
  description,
  action,
  children,
  className,
}: PageContainerProps) {
  return (
    <PageLayout className={cn("max-w-[1600px]", className)}>
      <PageHeader title={title} description={description} actions={action} />
      <PageContent>{children}</PageContent>
    </PageLayout>
  );
}
