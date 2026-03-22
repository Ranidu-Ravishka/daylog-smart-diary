import type { GenericId } from "convex/values";

export type AdminEntityTable =
  | "user"
  | "memories"
  | "daySummaries"
  | "integrations"
  | "days"
  | "userPreferences";

export type EntityId<T extends AdminEntityTable> = GenericId<T>;

export type UserId = EntityId<"user">;
export type MemoryId = EntityId<"memories">;
export type SummaryId = EntityId<"daySummaries">;
export type IntegrationId = EntityId<"integrations">;
export type DayId = EntityId<"days">;
export type PreferenceId = EntityId<"userPreferences">;

export function toEntityId<T extends AdminEntityTable>(
  value: string,
): EntityId<T> {
  return value as EntityId<T>;
}

export function idQueryArg<T extends AdminEntityTable, K extends string>(
  id: EntityId<T> | undefined,
  enabled: boolean | undefined,
  key: K,
): "skip" | { [P in K]: EntityId<T> } {
  if (!enabled || !id) {
    return "skip";
  }

  return { [key]: id } as { [P in K]: EntityId<T> };
}
