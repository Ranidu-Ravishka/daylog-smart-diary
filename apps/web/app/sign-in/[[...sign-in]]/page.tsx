import Link from "next/link";
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <Link href="/" className="mb-8 text-sm font-semibold tracking-tight">
        DayLog
      </Link>
      <SignIn
        appearance={{
          elements: {
            rootBox: "w-full max-w-sm",
            card: "shadow-sm border rounded-lg",
          },
        }}
      />
    </div>
  );
}
