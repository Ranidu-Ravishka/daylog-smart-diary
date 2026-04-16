"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { GenericId } from "convex/values";
import { LogOut, AlertTriangle } from "lucide-react";
import { api } from "@repo/backend/convex";
import {
  deriveDeletionState,
  formatDeletionStageLabel,
  getDeletionProgressPercent,
  getDeletionStateLabel,
  shouldLockDeletionNavigation,
} from "@repo/ui/lib/account-deletion";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { captureException, logInfo } from "@/lib/observability";
import { toastError, toastSuccess } from "@/lib/toast";

function getDeletionStatePillClasses(
  deletionState: ReturnType<typeof deriveDeletionState>,
): string {
  if (deletionState === "completed") {
    return "bg-success/15 text-success";
  }

  if (deletionState === "failed") {
    return "bg-destructive/15 text-destructive";
  }

  if (deletionState === "processing") {
    return "bg-warning/15 text-warning";
  }

  return "bg-muted text-muted-foreground";
}

function getDeletionProgressClasses(
  deletionState: ReturnType<typeof deriveDeletionState>,
): string {
  if (deletionState === "completed") {
    return "bg-success";
  }

  if (deletionState === "failed") {
    return "bg-destructive";
  }

  return "bg-primary";
}

export default function AccountPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const requestAccountDeletion = useMutation(api.users.requestAccountDeletion);
  const [pollToken, setPollToken] = useState(0);
  const [trackedDeletionJobId, setTrackedDeletionJobId] = useState<
    GenericId<"userDeletionJobs"> | undefined
  >(undefined);
  const deletionStatus = useQuery(api.users.getMyAccountDeletionStatus, {
    pollToken,
    jobId: trackedDeletionJobId,
  });
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);
  const [isFinalizingDeletion, setIsFinalizingDeletion] = useState(false);
  const [hasTriggeredClerkDelete, setHasTriggeredClerkDelete] = useState(false);

  const deletionState = deriveDeletionState(deletionStatus);
  const deletionStateLabel = deletionState
    ? getDeletionStateLabel(deletionState)
    : null;
  const deletionStageLabel = formatDeletionStageLabel(
    deletionStatus?.job?.stage,
  );
  const deletionProgressPercent = getDeletionProgressPercent(
    deletionState,
    deletionStatus?.job?.stage,
  );
  const lockUnsafeNavigation = shouldLockDeletionNavigation({
    deletionState,
    isFinalizingDeletion,
  });
  const isDeletionInProgress = Boolean(deletionStatus?.inProgress);
  const canRetryDeletion = Boolean(deletionStatus?.retryable);

  useEffect(() => {
    const jobIdFromStatus = deletionStatus?.job?.id;
    if (jobIdFromStatus && trackedDeletionJobId !== jobIdFromStatus) {
      setTrackedDeletionJobId(jobIdFromStatus);
    }
  }, [deletionStatus?.job?.id, trackedDeletionJobId]);

  useEffect(() => {
    if (
      !deletionStatus?.requested ||
      isFinalizingDeletion ||
      !trackedDeletionJobId
    ) {
      return;
    }

    if (deletionStatus.canDeleteClerkAccount || deletionStatus.retryable) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setPollToken((token) => token + 1);
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [
    deletionStatus?.canDeleteClerkAccount,
    deletionStatus?.requested,
    deletionStatus?.retryable,
    isFinalizingDeletion,
    trackedDeletionJobId,
  ]);

  useEffect(() => {
    if (!lockUnsafeNavigation) {
      return;
    }

    const lockMessage =
      "Account deletion is still running. Stay on this page until cleanup is finished or fails.";

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = lockMessage;
      return lockMessage;
    };

    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
      toastError(lockMessage);
    };

    const handleAnchorNavigation = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const anchor = target.closest("a[href]");
      if (!anchor) {
        return;
      }

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#")) {
        return;
      }

      if (anchor.getAttribute("target") === "_blank") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      toastError(lockMessage);
    };

    window.history.pushState(null, "", window.location.href);
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("popstate", handlePopState);
    document.addEventListener("click", handleAnchorNavigation, true);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("click", handleAnchorNavigation, true);
    };
  }, [lockUnsafeNavigation]);

  useEffect(() => {
    if (!deletionStatus?.canDeleteClerkAccount) {
      return;
    }

    if (hasTriggeredClerkDelete || isFinalizingDeletion) {
      return;
    }

    const finalizeClerkDeletion = async () => {
      setHasTriggeredClerkDelete(true);
      setIsFinalizingDeletion(true);

      logInfo("web_account_deletion_finalize_started", {
        status: "started",
        hasUser: Boolean(user),
        jobStatus: deletionStatus.job?.status,
      });

      try {
        if (!user) {
          throw new Error("Missing Clerk user while finalizing deletion");
        }

        await user.delete();
        await signOut();

        logInfo("web_account_deletion_succeeded", {
          status: "succeeded",
          hasUser: true,
        });
        toastSuccess("Account deleted successfully.");
      } catch (err) {
        captureException("web_account_delete_finalize_failed", err, {
          status: "failed",
          hasUser: Boolean(user),
        });
        toastError(
          "Backend cleanup completed, but we could not finalize account deletion. Please retry.",
        );
        setHasTriggeredClerkDelete(false);
        setIsFinalizingDeletion(false);
      }
    };

    void finalizeClerkDeletion();
  }, [
    deletionStatus?.canDeleteClerkAccount,
    deletionStatus?.job?.status,
    hasTriggeredClerkDelete,
    isFinalizingDeletion,
    signOut,
    user,
  ]);

  const submitAccountDeletionRequest = async () => {
    logInfo("web_account_deletion_request_started", {
      status: "started",
      hasUser: Boolean(user),
      hasExistingJob: Boolean(deletionStatus?.job),
    });

    setIsRequestingDeletion(true);
    try {
      const response = await requestAccountDeletion({});
      setTrackedDeletionJobId(response.jobId);
      setPollToken((token) => token + 1);

      logInfo("web_account_deletion_request_succeeded", {
        status: "succeeded",
        hasUser: Boolean(user),
        jobId: response.jobId,
        jobStatus: response.status,
        jobStage: response.stage,
        created: response.created,
        retried: response.retried,
      });

      if (response.canDeleteClerkAccount) {
        toastSuccess(
          "Backend cleanup is complete. Finalizing account deletion now.",
        );
      } else if (response.retried) {
        toastSuccess(
          "Retrying backend cleanup. Your account will be deleted automatically once cleanup completes.",
        );
      } else if (response.created) {
        toastSuccess(
          "Account cleanup started. Keep this page open while we finish deletion.",
        );
      } else {
        toastSuccess(
          "Account cleanup is already running. We will finish deletion automatically.",
        );
      }
    } catch (err) {
      captureException("web_account_deletion_request_failed", err, {
        status: "failed",
        hasUser: Boolean(user),
      });
      toastError("Failed to start account deletion. Please try again.");
    } finally {
      setIsRequestingDeletion(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (confirmText !== "DELETE") {
      return;
    }

    await submitAccountDeletionRequest();
  };

  const handleSignOut = async () => {
    if (lockUnsafeNavigation) {
      toastError(
        "Sign out is blocked while deletion cleanup is still running.",
      );
      return;
    }

    await signOut();
  };

  const deletionButtonLabel = isFinalizingDeletion
    ? "Finalizing account deletion…"
    : isRequestingDeletion
      ? "Requesting backend deletion…"
      : isDeletionInProgress
        ? "Cleaning up backend data…"
        : "Permanently delete";

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Account</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Manage your account settings and data.
      </p>

      {/* ── Info ──────────────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Account Information</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 pb-5 space-y-0">
          <div className="flex justify-between items-center py-2.5">
            <span className="text-sm text-muted-foreground">Name</span>
            <span className="text-sm font-medium">
              {user?.firstName} {user?.lastName}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between items-center py-2.5">
            <span className="text-sm text-muted-foreground">Email</span>
            <span className="text-sm font-medium">
              {user?.primaryEmailAddress?.emailAddress}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between items-center py-2.5">
            <span className="text-sm text-muted-foreground">Member since</span>
            <span className="text-sm font-medium">
              {user?.createdAt
                ? new Date(user.createdAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })
                : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* ── Session ───────────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader className="pb-0">
          <CardTitle className="text-sm">Session</CardTitle>
          <CardDescription>
            Sign out of your account on this device.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 pb-5">
          <Button
            variant="outline"
            onClick={handleSignOut}
            disabled={lockUnsafeNavigation}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
          {lockUnsafeNavigation ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Sign out is temporarily disabled while secure deletion cleanup is
              in progress.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* ── Danger zone ───────────────────────────────── */}
      <Card className="border-destructive/30">
        <CardHeader className="pb-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <CardTitle className="text-sm text-destructive">
              Danger Zone
            </CardTitle>
          </div>
          <CardDescription>
            Permanently delete your account and all associated data. This cannot
            be undone.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4 pb-5">
          {!showConfirm ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowConfirm(true)}
            >
              Delete my account
            </Button>
          ) : (
            <div className="space-y-3 rounded-md border border-destructive/20 p-4">
              <p className="text-sm">
                Type{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-destructive">
                  DELETE
                </code>{" "}
                to confirm:
              </p>
              <Input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="Type DELETE"
              />

              {deletionStatus?.requested ? (
                <div className="rounded-md border border-muted bg-muted/30 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {deletionStateLabel ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${getDeletionStatePillClasses(
                          deletionState,
                        )}`}
                      >
                        {deletionStateLabel}
                      </span>
                    ) : null}

                    {deletionStatus.job?.id ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        Job {deletionStatus.job.id}
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>Stage: {deletionStageLabel}</span>
                      <span>{deletionProgressPercent}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${getDeletionProgressClasses(
                          deletionState,
                        )}`}
                        style={{ width: `${deletionProgressPercent}%` }}
                      />
                    </div>
                  </div>

                  {deletionState === "requested" ||
                  deletionState === "processing" ? (
                    <p className="text-xs text-muted-foreground">
                      Secure cleanup is running. Please keep this page open so
                      we can finish deletion safely.
                    </p>
                  ) : null}

                  {deletionState === "failed" ? (
                    <p className="text-xs text-destructive">
                      Cleanup failed.{" "}
                      {deletionStatus.job?.lastError ?? "Unknown error."}
                    </p>
                  ) : null}

                  {deletionState === "completed" ? (
                    <p className="text-xs text-muted-foreground">
                      Backend cleanup completed. Finalizing account deletion
                      now.
                    </p>
                  ) : null}

                  {deletionStatus.retryable ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={submitAccountDeletionRequest}
                      disabled={isRequestingDeletion || isFinalizingDeletion}
                    >
                      Retry backend cleanup
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteAccount}
                  disabled={
                    confirmText !== "DELETE" ||
                    isRequestingDeletion ||
                    isFinalizingDeletion ||
                    (isDeletionInProgress && !canRetryDeletion)
                  }
                >
                  {deletionButtonLabel}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowConfirm(false);
                    setConfirmText("");
                  }}
                  disabled={isRequestingDeletion || isFinalizingDeletion}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
