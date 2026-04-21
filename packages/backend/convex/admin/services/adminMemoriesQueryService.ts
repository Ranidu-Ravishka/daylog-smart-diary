import type { Doc, Id } from "../../_generated/dataModel";
import { requireAdmin } from "../../authz";
import {
  mapAdminMemoryRecord,
  type AdminMemoryRecord,
} from "../utilities/adminRecordMappers";

type PaginatedResult = {
  page: Doc<"memories">[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: string | null;
};

async function mapMemoryPage(page: PaginatedResult) {
  return {
    ...page,
    page: await Promise.all(
      page.page.map(
        async (row) => await mapAdminMemoryRecord(row as AdminMemoryRecord),
      ),
    ),
  };
}

export async function listMemoriesPaginatedImpl(
  ctx: Parameters<typeof requireAdmin>[0],
  args: {
    paginationOpts: {
      numItems: number;
      cursor: string | null;
      id?: number;
    };
    dayKey?: string;
    userId?: Id<"user">;
  },
) {
  await requireAdmin(ctx);

  if (args.userId) {
    const page = await ctx.db
      .query("memories")
      .withIndex("by_user_happenedAt", (q) => q.eq("userId", args.userId!))
      .order("desc")
      .paginate(args.paginationOpts);
    return await mapMemoryPage(page as PaginatedResult);
  }

  if (args.dayKey) {
    const page = await ctx.db
      .query("memories")
      .withIndex("by_day_happenedAt", (q) => q.eq("dayKey", args.dayKey!))
      .order("desc")
      .paginate(args.paginationOpts);
    return await mapMemoryPage(page as PaginatedResult);
  }

  const page = await ctx.db
    .query("memories")
    .withIndex("by_happenedAt")
    .order("desc")
    .paginate(args.paginationOpts);
  return await mapMemoryPage(page as PaginatedResult);
}
