import type { Doc, Id } from "../../_generated/dataModel";
import { requireAdmin } from "../../authz";
import {
  mapAdminDayRecord,
  type AdminDayRecord,
} from "../utilities/adminRecordMappers";

type PaginatedDayResult = {
  page: Doc<"days">[];
  isDone: boolean;
  continueCursor: string;
  splitCursor?: string | null;
  pageStatus?: string | null;
};

async function mapDayPage(page: PaginatedDayResult) {
  return {
    ...page,
    page: await Promise.all(
      page.page.map(
        async (row) => await mapAdminDayRecord(row as AdminDayRecord),
      ),
    ),
  };
}

export async function listDaysPaginatedImpl(
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
      .query("days")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", args.userId!).eq("dayKey", args.dayKey!),
      )
      .paginate(args.paginationOpts);
    return await mapDayPage(page as PaginatedDayResult);
  }

  if (args.userId) {
    const page = await ctx.db
      .query("days")
      .withIndex("by_user_day", (q) => q.eq("userId", args.userId!))
      .order("desc")
      .paginate(args.paginationOpts);
    return await mapDayPage(page as PaginatedDayResult);
  }

  if (args.dayKey) {
    const page = await ctx.db
      .query("days")
      .withIndex("by_dayKey", (q) => q.eq("dayKey", args.dayKey!))
      .paginate(args.paginationOpts);
    return await mapDayPage(page as PaginatedDayResult);
  }

  const page = await ctx.db
    .query("days")
    .withIndex("by_dayKey")
    .order("desc")
    .paginate(args.paginationOpts);
  return await mapDayPage(page as PaginatedDayResult);
}
