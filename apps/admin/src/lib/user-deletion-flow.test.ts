import { describe, expect, it } from "vitest";

import {
  buildActiveDeletionStatusByUserId,
  buildRowDeletionStatusByUserId,
  isDeletionJobActive,
  isDeletionJobTerminal,
  type DeletionJobStatus,
} from "./user-deletion-flow";

type FixtureJob = {
  userId: string;
  status: DeletionJobStatus;
  updatedAt: number;
};

describe("admin user deletion flow", () => {
  it("identifies active and terminal states", () => {
    expect(isDeletionJobActive("requested")).toBe(true);
    expect(isDeletionJobActive("processing")).toBe(true);
    expect(isDeletionJobActive("completed")).toBe(false);
    expect(isDeletionJobActive("failed")).toBe(false);

    expect(isDeletionJobTerminal("completed")).toBe(true);
    expect(isDeletionJobTerminal("failed")).toBe(true);
    expect(isDeletionJobTerminal("requested")).toBe(false);
  });

  it("keeps latest active status per user", () => {
    const statuses = buildActiveDeletionStatusByUserId<FixtureJob>([
      { userId: "u_1", status: "requested", updatedAt: 10 },
      { userId: "u_1", status: "processing", updatedAt: 20 },
      { userId: "u_2", status: "completed", updatedAt: 30 },
      { userId: "u_3", status: "processing", updatedAt: 15 },
      { userId: "u_3", status: "requested", updatedAt: 5 },
    ]);

    expect(statuses.get("u_1")).toBe("processing");
    expect(statuses.get("u_3")).toBe("processing");
    expect(statuses.has("u_2")).toBe(false);
  });

  it("maps latest non-completed job into row deletion status", () => {
    const statuses = buildRowDeletionStatusByUserId<FixtureJob>([
      { userId: "u_1", status: "requested", updatedAt: 10 },
      { userId: "u_1", status: "processing", updatedAt: 20 },
      { userId: "u_2", status: "failed", updatedAt: 30 },
      { userId: "u_2", status: "completed", updatedAt: 40 },
      { userId: "u_3", status: "completed", updatedAt: 50 },
    ]);

    expect(statuses.get("u_1")).toBe("processing");
    expect(statuses.get("u_2")).toBe("failed");
    expect(statuses.has("u_3")).toBe(false);
  });
});
