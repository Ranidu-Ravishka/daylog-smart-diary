"use client";
import Link from "next/link";
import { SignedIn, SignedOut, SignOutButton, useUser } from "@clerk/nextjs";

const hasClerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

function StaticNavigations() {
  return (
    <nav className="w-full flex h-16 items-center justify-between px-4 border-b border-gray-200 shadow-lg mb-4">
      <div className="flex">
        <span className="font-bold">Admin Panel</span>
      </div>
      <div className="flex gap-3 items-center">
        <Link href="/admin/dashboard">Dashboard</Link>
        <Link href="/content">Content</Link>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-500">Auth not configured</span>
      </div>
    </nav>
  );
}

function ClerkNavigations() {
  const { user } = useUser();
  return (
    <nav className="w-full flex h-16 items-center justify-between px-4 border-b border-gray-200 shadow-lg mb-4">
      <div className="flex">
        <span className="font-bold">Admin Panel</span>
      </div>
      <div className="flex gap-3 items-center">
        <Link href="/admin/dashboard">Dashboard</Link>
        <Link href="/content">Content</Link>
      </div>
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
  return hasClerk ? <ClerkNavigations /> : <StaticNavigations />;
}
