"use client";
import Link from "next/link";
import { SignedIn, SignedOut, SignOutButton, useUser } from "@clerk/nextjs";

const navLinks = [
  { href: "/admin/dashboard", label: "Dashboard" },
  { href: "/content", label: "Content" },
  { href: "/users", label: "Users" },
  { href: "/memories", label: "Memories" },
  { href: "/days", label: "Days" },
  { href: "/summaries", label: "Summaries" },
  { href: "/integrations", label: "Integrations" },
  { href: "/preferences", label: "Preferences" },
  { href: "/audit-logs", label: "Audit Logs" },
];

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function BaseNavLinks() {
  return (
    <div className="flex gap-3 items-center">
      {navLinks.map((link) => (
        <Link key={link.href} href={link.href}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}

function NavigationWithoutClerk() {
  return (
    <nav className="w-full flex h-16 items-center justify-between px-4 border-b border-gray-200 shadow-lg mb-4">
      <div className="flex">
        <span className="font-bold">Admin Panel</span>
      </div>
      <BaseNavLinks />
      <div className="flex items-center gap-3">
        <Link
          href="/sign-in"
          className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          Login
        </Link>
      </div>
    </nav>
  );
}

function NavigationWithClerk() {
  const { user } = useUser();

  return (
    <nav className="w-full flex h-16 items-center justify-between px-4 border-b border-gray-200 shadow-lg mb-4">
      <div className="flex">
        <span className="font-bold">Admin Panel</span>
      </div>
      <BaseNavLinks />
      <div className="flex items-center gap-3">
        <SignedOut>
          <Link
            href="/sign-in"
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            Login
          </Link>
        </SignedOut>
        <SignedIn>
          <SignOutButton>
            <button className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
              Logout
            </button>
          </SignOutButton>
          <Link href="/profile">
            <div className="size-9 rounded-full overflow-hidden bg-indigo-600 text-white flex items-center justify-center font-semibold">
              {user?.firstName?.charAt(0).trim().toUpperCase() ||
                user?.primaryEmailAddress?.emailAddress
                  ?.charAt(0)
                  .trim()
                  .toUpperCase() ||
                "U"}
            </div>
          </Link>
        </SignedIn>
      </div>
    </nav>
  );
}

export default function Navigations() {
  if (!hasClerk) {
    return <NavigationWithoutClerk />;
  }

  return <NavigationWithClerk />;
}
