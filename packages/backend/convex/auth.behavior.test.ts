import { describe, expect, it } from "vitest";

import type { Id } from "./_generated/dataModel";
import { listAuditLogsPaginatedImpl } from "./admin/services/auditLogsService";
import { requireAdmin, requireIdentityMatch, requireUser } from "./authz";
import { createAuthCtx, createInMemoryDb } from "../test-utils/inMemoryConvex";

const ADMIN_USER_ID = "user_admin_001" as Id<"user">;
const MEMBER_USER_ID = "user_member_001" as Id<"user">;

function seededDb() {
  return createInMemoryDb({
    user: [
      {
        _id: ADMIN_USER_ID,
        _creationTime: 1,
        clerkUserId: "clerk_admin_001",
        isAdmin: true,
      },
      {
        _id: MEMBER_USER_ID,
        _creationTime: 2,
        clerkUserId: "clerk_member_001",
        isAdmin: false,
      },
    ],
  });
}

describe("auth boundary behavior", () => {
  it("rejects Convex access while account deletion is in progress", async () => {
    const db = createInMemoryDb({
      user: [
        {
          _id: MEMBER_USER_ID,
          _creationTime: 2,
          clerkUserId: "clerk_member_001",
          isAdmin: false,
          accountStatus: "deletion_requested" as const,
        },
      ],
    });
    const ctx = createAuthCtx(db, "clerk_member_001");

    await expect(requireUser(ctx as never)).rejects.toThrow(
      "Unauthorized: account deletion in progress",
    );
  });

  it("rejects Convex access when backend data was purged pending Clerk removal", async () => {
    const db = createInMemoryDb({
      user: [
        {
          _id: MEMBER_USER_ID,
          _creationTime: 2,
          clerkUserId: "clerk_member_001",
          isAdmin: false,
          accountStatus: "deletion_requested" as const,
          accountBackendPurgedAt: 99,
        },
      ],
    });
    const ctx = createAuthCtx(db, "clerk_member_001");

    await expect(requireUser(ctx as never)).rejects.toThrow(
      "Unauthorized: account backend data was removed",
    );
  });

  it("returns 401 when token is missing", async () => {
    const ctx = createAuthCtx(seededDb(), null);

    await expect(requireUser(ctx as never)).rejects.toThrow("Unauthorized");
  });

  it("returns 401 when identity has no matching user record", async () => {
    const ctx = createAuthCtx(seededDb(), "clerk_unknown");

    await expect(requireUser(ctx as never)).rejects.toThrow(
      "Unauthorized: user record not found",
    );
  });

  it("returns 403 when authenticated user lacks admin role", async () => {
    const ctx = createAuthCtx(seededDb(), "clerk_member_001");

    await expect(requireAdmin(ctx as never)).rejects.toThrow("Forbidden");
  });

  it("enforces identity ownership checks", async () => {
    const ctx = createAuthCtx(seededDb(), "clerk_member_001");

    await expect(
      requireIdentityMatch(ctx as never, "clerk_admin_001"),
    ).rejects.toThrow("Forbidden: identity mismatch");
  });

  it("protects admin audit endpoint with 401 and 403 boundaries", async () => {
    const unauthenticated = createAuthCtx(seededDb(), null);
    const nonAdmin = createAuthCtx(seededDb(), "clerk_member_001");

    await expect(
      listAuditLogsPaginatedImpl(unauthenticated as never, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Unauthorized");

    await expect(
      listAuditLogsPaginatedImpl(nonAdmin as never, {
        paginationOpts: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow("Forbidden");
  });

  it("rejects conflicting audit user filter aliases", async () => {
    const adminCtx = createAuthCtx(seededDb(), "clerk_admin_001");

    await expect(
      listAuditLogsPaginatedImpl(adminCtx as never, {
        paginationOpts: { numItems: 10, cursor: null },
        userId: ADMIN_USER_ID,
        actorUserId: MEMBER_USER_ID,
      }),
    ).rejects.toThrow("Conflicting userId and actorUserId filters provided");
  });
});
