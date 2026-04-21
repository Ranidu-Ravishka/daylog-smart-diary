import type { Doc } from "../../_generated/dataModel";

export function buildAdminRoleStatePatch(
  user: Partial<
    Pick<Doc<"user">, "isAdmin" | "adminAuthVersion" | "adminRoleUpdatedAt">
  >,
  nextIsAdmin: boolean,
  now = Date.now(),
): {
  isAdmin: boolean;
  adminAuthVersion: number;
  adminRoleUpdatedAt: number;
} {
  const currentIsAdmin = user.isAdmin === true;
  const currentVersion = user.adminAuthVersion ?? 0;
  const roleChanged = currentIsAdmin !== nextIsAdmin;

  return {
    isAdmin: nextIsAdmin,
    adminAuthVersion: roleChanged ? currentVersion + 1 : currentVersion,
    adminRoleUpdatedAt: roleChanged ? now : (user.adminRoleUpdatedAt ?? now),
  };
}
