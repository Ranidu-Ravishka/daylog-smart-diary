import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <SignIn
        path="/sign-in"
        signUpUrl="/sign-up"
        forceRedirectUrl="/auth/callback"
      />
    </div>
  );
}
