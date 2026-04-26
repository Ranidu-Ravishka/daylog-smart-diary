import type { GenericId } from "convex/values";

export type MemoryItem = {
  _id: GenericId<"memories">;
  title?: string;
  description?: string;
  mood?: string;
  thumbnailUrl?: string | null;
  happenedAt?: number;
  tags?: string[];
  location?: string;
  linkedPeople?: string[];
};
