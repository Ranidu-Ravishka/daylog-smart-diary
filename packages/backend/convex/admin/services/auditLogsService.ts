import type { Id } from "../../_generated/dataModel";
import { requireAdmin } from "../../authz";
import { clampLimit } from "../../validators";

export async function listAuditLogsPaginatedImpl(
  ctx: Parameters<typeof requireAdmin>[0],
  args: {
    paginationOpts: {
      numItems: number;
      cursor: string | null;
      id?: number;
    };
    userId?: Id<"user">;
    actorUserId?: Id<"user">;
    action?: string;
    fromTs?: number;
    toTs?: number;
  },
) {
  await requireAdmin(ctx);

  if (
    args.fromTs !== undefined &&
    args.toTs !== undefined &&
    args.fromTs > args.toTs
  ) {
    throw new Error("fromTs must be less than or equal to toTs");
  }

  const userId = args.userId ?? args.actorUserId;
  const paginationOpts = {
    ...args.paginationOpts,
    numItems: clampLimit(args.paginationOpts.numItems, 200),
  };

  if (
    args.userId !== undefined &&
    args.actorUserId !== undefined &&
    args.userId !== args.actorUserId
  ) {
    throw new Error("Conflicting userId and actorUserId filters provided");
  }

  if (userId && args.action) {
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_userId_action_createdAt", (q) => {
        if (args.fromTs !== undefined && args.toTs !== undefined) {
          return q
            .eq("actorUserId", userId)
            .eq("action", args.action!)
            .gte("at", args.fromTs)
            .lte("at", args.toTs);
        }

        if (args.fromTs !== undefined) {
          return q
            .eq("actorUserId", userId)
            .eq("action", args.action!)
            .gte("at", args.fromTs);
        }

        if (args.toTs !== undefined) {
          return q
            .eq("actorUserId", userId)
            .eq("action", args.action!)
            .lte("at", args.toTs);
        }

        return q.eq("actorUserId", userId).eq("action", args.action!);
      })
      .order("desc")
      .paginate(paginationOpts);
  }

  if (userId) {
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_userId_createdAt", (q) => {
        if (args.fromTs !== undefined && args.toTs !== undefined) {
          return q
            .eq("actorUserId", userId)
            .gte("at", args.fromTs)
            .lte("at", args.toTs);
        }

        if (args.fromTs !== undefined) {
          return q.eq("actorUserId", userId).gte("at", args.fromTs);
        }

        if (args.toTs !== undefined) {
          return q.eq("actorUserId", userId).lte("at", args.toTs);
        }

        return q.eq("actorUserId", userId);
      })
      .order("desc")
      .paginate(paginationOpts);
  }

  if (args.action) {
    return await ctx.db
      .query("auditLogs")
      .withIndex("by_action_createdAt", (q) => {
        if (args.fromTs !== undefined && args.toTs !== undefined) {
          return q
            .eq("action", args.action!)
            .gte("at", args.fromTs)
            .lte("at", args.toTs);
        }

        if (args.fromTs !== undefined) {
          return q.eq("action", args.action!).gte("at", args.fromTs);
        }

        if (args.toTs !== undefined) {
          return q.eq("action", args.action!).lte("at", args.toTs);
        }

        return q.eq("action", args.action!);
      })
      .order("desc")
      .paginate(paginationOpts);
  }

  return await ctx.db
    .query("auditLogs")
    .withIndex("by_createdAt", (q) => {
      if (args.fromTs !== undefined && args.toTs !== undefined) {
        return q.gte("at", args.fromTs).lte("at", args.toTs);
      }

      if (args.fromTs !== undefined) {
        return q.gte("at", args.fromTs);
      }

      if (args.toTs !== undefined) {
        return q.lte("at", args.toTs);
      }

      return q;
    })
    .order("desc")
    .paginate(paginationOpts);
}
