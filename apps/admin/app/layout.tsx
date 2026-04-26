import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ClerkProvider } from "@clerk/nextjs";
import { AppProviders } from "./providers";
import { AppChrome } from "@/components/app-chrome";
import { Toaster } from "sonner";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
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
