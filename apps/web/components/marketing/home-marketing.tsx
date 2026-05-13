import dynamic from "next/dynamic";
import { HomeMarketingHeroAndProduct } from "@/components/marketing/home-marketing-hero-and-product";

function MarketingBelowFoldSkeleton() {
  return (
    <div
      className="border-t border-border/40 bg-muted/10 px-5 py-20 sm:px-8"
      aria-busy="true"
      aria-label="Loading more sections"
    >
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="mx-auto h-9 max-w-lg animate-pulse rounded-xl bg-muted/50" />
        <div className="mx-auto h-40 max-w-4xl animate-pulse rounded-2xl bg-muted/40" />
        <div className="mx-auto h-40 max-w-4xl animate-pulse rounded-2xl bg-muted/35" />
        <div className="mx-auto h-36 max-w-3xl animate-pulse rounded-2xl bg-muted/30" />
      </div>
    </div>
  );
}

const HomeMarketingBelowFold = dynamic(
  () =>
    import("@/components/marketing/home-marketing-below-fold").then(
      (m) => m.HomeMarketingBelowFold,
    ),
  {
    loading: () => <MarketingBelowFoldSkeleton />,
    ssr: true,
  },
);

export function HomeMarketing() {
  return (
    <>
      <HomeMarketingHeroAndProduct />
      <HomeMarketingBelowFold />
    </>
  );
}
