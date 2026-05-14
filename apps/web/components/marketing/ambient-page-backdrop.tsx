export function AmbientPageBackdrop() {
  return (
    <div
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      aria-hidden
    >
      <div className="absolute -left-[20%] top-[-10%] h-[min(70vh,520px)] w-[min(70vw,520px)] rounded-full bg-[radial-gradient(closest-side,hsl(var(--glow-1)/0.45),transparent)] blur-3xl dark:bg-[radial-gradient(closest-side,hsl(var(--glow-1)/0.28),transparent)]" />
      <div className="absolute -right-[15%] top-[25%] h-[min(60vh,440px)] w-[min(65vw,480px)] rounded-full bg-[radial-gradient(closest-side,hsl(var(--glow-2)/0.35),transparent)] blur-3xl dark:bg-[radial-gradient(closest-side,hsl(var(--glow-2)/0.22),transparent)]" />
      <div className="absolute bottom-[-20%] left-[20%] h-[min(50vh,400px)] w-[min(80vw,640px)] rounded-full bg-[radial-gradient(closest-side,hsl(var(--glow-3)/0.25),transparent)] blur-3xl dark:bg-[radial-gradient(closest-side,hsl(var(--glow-3)/0.15),transparent)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--background)/0.92)_35%,hsl(var(--background)/0.65)_100%)] dark:bg-[linear-gradient(180deg,hsl(var(--background))_0%,hsl(var(--background)/0.94)_40%,hsl(var(--background)/0.72)_100%)]" />
    </div>
  );
}
