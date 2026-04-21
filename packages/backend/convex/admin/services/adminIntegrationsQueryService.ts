import { requireAdmin } from "../../authz";

type IntegrationStatus = "connected" | "disconnected" | "error";

export async function listIntegrationsPaginatedImpl(
  ctx: Parameters<typeof requireAdmin>[0],
  args: {
    paginationOpts: {
      numItems: number;
      cursor: string | null;
      id?: number;
    };
    status?: IntegrationStatus;
    provider?: string;
  },
) {
  await requireAdmin(ctx);

  if (args.status && args.provider) {
    return await ctx.db
      .query("integrations")
      .withIndex("by_status_provider", (q) =>
        q.eq("status", args.status!).eq("provider", args.provider!),
      )
      .paginate(args.paginationOpts);
  }

  if (args.status) {
    return await ctx.db
      .query("integrations")
      .withIndex("by_status", (q) => q.eq("status", args.status!))
      .paginate(args.paginationOpts);
  }

  if (args.provider) {
    return await ctx.db
      .query("integrations")
      .withIndex("by_provider", (q) => q.eq("provider", args.provider!))
      .paginate(args.paginationOpts);
  }

  return await ctx.db
    .query("integrations")
    .withIndex("by_provider")
    .paginate(args.paginationOpts);
}
