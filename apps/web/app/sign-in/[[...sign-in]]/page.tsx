import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { AmbientPageBackdrop } from "@/components/marketing/ambient-page-backdrop";

export default function SignInPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12 sm:px-6">
      <AmbientPageBackdrop />
      <Link
        href="/"
        className="relative z-10 mb-8 text-sm font-semibold tracking-tight text-foreground/90 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-md"
      >
        DayLog
      </Link>
      <div className="relative z-10 w-full max-w-sm">
        <SignIn
          appearance={{
            elements: {
              rootBox: "w-full",
              card: "rounded-2xl border border-border/60 bg-card/80 shadow-soft backdrop-blur-xl",
              formButtonPrimary: "h-11 rounded-xl",
              formFieldInput: "min-h-[44px] rounded-xl",
              socialButtonsBlockButton: "min-h-[44px] rounded-xl",
            },
          }}
        />
      </div>
    </div>
  );
}
