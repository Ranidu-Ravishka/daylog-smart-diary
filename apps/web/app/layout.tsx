import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "DayLog — AI-Powered Daily Reflection",
  description:
    "Capture your day, get AI-generated summaries, and discover personal insights. DayLog helps you build a meaningful daily reflection habit.",
};

const themeBootstrapScript = `(() => {
  try {
    const storageKey = "daylog.theme.preference";
    const stored = window.localStorage.getItem(storageKey);
    const preference =
      stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "system";

    const prefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;

    const resolved = preference === "system" ? (prefersDark ? "dark" : "light") : preference;
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
    root.dataset.themePreference = preference;
  } catch {
    // Keep startup resilient even if localStorage or matchMedia is unavailable.
  }
})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
