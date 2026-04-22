import type { DeletionJobStatus } from "@/lib/user-deletion-flow";

export type AdminLookupUser = {
  _id: string;
  email: string;
  clerkUserId: string;
};

export type AdminDeleteUserResult = {
  queued?: boolean;
  jobId?: string;
  status?: DeletionJobStatus;
  stage?: string;
};

export type RevokeUserSessionsRequestBody = {
  clerkUserId?: unknown;
};

export type ApiErrorResponse = {
  error?: string;
};
