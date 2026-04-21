import type { Doc, Id } from "../../_generated/dataModel";
import { requireAdmin } from "../../authz";
import {
  mapAdminSummaryRecord,
  type AdminSummaryRecord,
} from "../utilities/adminRecordMappers";

type PaginatedSummaryResult = {
  page: Doc<"daySummaries">[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: string | null;
};

async function mapSummaryPage(page: PaginatedSummaryResult) {
  return {
    ...page,
    page: await Promise.all(
      page.page.map(
        async (row) =>
          await mapAdminSummaryRecord(row as unknown as AdminSummaryRecord),
      ),
    ),
  };
}

export async function listSummariesPaginatedImpl(
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

  if (args.userId && args.dayKey) {
    const page = await ctx.db
      .query("daySummaries")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", args.userId!).eq("dayKey", args.dayKey!),
      )
      .paginate(args.paginationOpts);
    return await mapSummaryPage(page as PaginatedSummaryResult);
  }

  if (args.userId) {
    const page = await ctx.db
      .query("daySummaries")
      .withIndex("by_user_generatedAt", (q) => q.eq("userId", args.userId!))
      .order("desc")
      .paginate(args.paginationOpts);
    return await mapSummaryPage(page as PaginatedSummaryResult);
  }

  if (args.dayKey) {
    const page = await ctx.db
      .query("daySummaries")
      .withIndex("by_day_generatedAt", (q) => q.eq("dayKey", args.dayKey!))
      .order("desc")
      .paginate(args.paginationOpts);
    return await mapSummaryPage(page as PaginatedSummaryResult);
  }

  const page = await ctx.db
    .query("daySummaries")
    .withIndex("by_generatedAt")
    .order("desc")
    .paginate(args.paginationOpts);
  return await mapSummaryPage(page as PaginatedSummaryResult);
}
