"use client";

import { useMemo, useState } from "react";
import { makeFunctionReference } from "convex/server";
import { usePaginatedQuery } from "convex/react";

type OwnerSelectorValueMode = "userId" | "clerkUserId";

type UserOwnerSelectorProps = {
  isAdmin: boolean | undefined;
  value: string;
  onChange: (value: string) => void;
  valueMode: OwnerSelectorValueMode;
  helperText: string;
};

type UserRow = {
  _id: string;
  email: string;
  clerkUserId: string;
};

export default function UserOwnerSelector({
  isAdmin,
  value,
  onChange,
  valueMode,
  helperText,
}: UserOwnerSelectorProps) {
  const listUsersPaginatedRef = makeFunctionReference<"query">(
    "admin:listUsersPaginated",
  );
  const [search, setSearch] = useState("");

  const { results, status, loadMore } = usePaginatedQuery(
    listUsersPaginatedRef,
    isAdmin ? {} : "skip",
    { initialNumItems: 50 },
  );

  const users = results as UserRow[];

  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = useMemo(() => {
    if (!normalizedSearch) return users;

    return users.filter((user) => {
      const email = user.email.toLowerCase();
      const clerkUserId = user.clerkUserId.toLowerCase();
      const userId = String(user._id).toLowerCase();

      return (
        email.includes(normalizedSearch) ||
        clerkUserId.includes(normalizedSearch) ||
        userId.includes(normalizedSearch)
      );
    });
  }, [normalizedSearch, users]);

  return (
    <div className="mb-6 space-y-2">
      <label className="block text-sm font-medium text-foreground mb-1">
        Owner (User)
      </label>
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search loaded users by email, Clerk ID, or user ID"
        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring  "
      />
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring  "
      >
        <option value="">Select a user...</option>
        {filteredUsers.map((user) => {
          const optionValue =
            valueMode === "clerkUserId" ? user.clerkUserId : String(user._id);

          return (
            <option key={user._id} value={optionValue}>
              {user.email} ({optionValue})
            </option>
          );
        })}
      </select>

      {status === "CanLoadMore" && (
        <button
          type="button"
          onClick={() => loadMore(50)}
          className="inline-flex items-center rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground shadow-sm transition hover:bg-muted"
        >
          Load more users
        </button>
      )}

      <p className="text-xs text-muted-foreground">{helperText}</p>
    </div>
  );
}
