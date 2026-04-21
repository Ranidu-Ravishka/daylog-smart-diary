import { requireAdmin } from "../../authz";

async function attachPreferenceUserEmail<
  TPreference extends { clerkUserId: string },
>(ctx: Parameters<typeof requireAdmin>[0], pref: TPreference) {
  const user = await ctx.db
    .query("user")
    .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", pref.clerkUserId))
    .unique();

  return { ...pref, email: user?.email ?? null };
}

export async function listAllUserPreferencesWithEmailImpl(
  ctx: Parameters<typeof requireAdmin>[0],
) {
  await requireAdmin(ctx);

  const prefs = await ctx.db
    .query("userPreferences")
    .withIndex("by_updatedAt")
    .order("desc")
    .take(200);

  return await Promise.all(
    prefs.map(async (pref) => await attachPreferenceUserEmail(ctx, pref)),
  );
}

export async function listUserPreferencesPaginatedWithEmailImpl(
  ctx: Parameters<typeof requireAdmin>[0],
  args: {
    paginationOpts: {
      numItems: number;
      cursor: string | null;
      id?: number;
    };
  },
) {
  await requireAdmin(ctx);

  const page = await ctx.db
    .query("userPreferences")
    .withIndex("by_updatedAt")
    .order("desc")
    .paginate(args.paginationOpts);

  const pageWithUserEmail = await Promise.all(
    page.page.map(async (pref) => await attachPreferenceUserEmail(ctx, pref)),
  );

  return {
    ...page,
    page: pageWithUserEmail,
  };
}
