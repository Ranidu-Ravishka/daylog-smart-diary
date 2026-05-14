import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { AppProviders } from "./providers";
import { AppChrome } from "@/components/app-chrome";
import { Toaster } from "sonner";

const satoshi = localFont({
  src: [
    { path: "./fonts/Satoshi-Regular.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Satoshi-Medium.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Satoshi-Bold.woff2", weight: "600", style: "normal" },
    { path: "./fonts/Satoshi-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DayLog | Admin",
  description: "DayLog Admin Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

  const app = (
    <AppProviders>
      <AppChrome>{children}</AppChrome>
      <Toaster
        position="top-right"
        closeButton
        toastOptions={{
          classNames: {
            toast: "bg-card text-card-foreground border-border",
            title: "text-foreground",
            description: "text-muted-foreground",
            closeButton: "text-muted-foreground hover:text-foreground",
          },
        }}
      />
    </AppProviders>
  );

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className={`${satoshi.variable} antialiased`}
      >
        {clerkPublishableKey ? (
          <ClerkProvider publishableKey={clerkPublishableKey}>
            {app}
          </ClerkProvider>
        ) : (
          app
        )}
      </body>
    </html>
  );
}
