"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { LogOut, AlertTriangle } from "lucide-react";
import { api } from "@repo/backend/convex";
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

export default function AccountPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const requestAccountDeletion = useMutation(api.users.requestAccountDeletion);
  const [pollToken, setPollToken] = useState(0);
  const deletionStatus = useQuery(api.users.getMyAccountDeletionStatus, {
    pollToken,
  });
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isRequestingDeletion, setIsRequestingDeletion] = useState(false);
  const [isFinalizingDeletion, setIsFinalizingDeletion] = useState(false);
  const [hasTriggeredClerkDelete, setHasTriggeredClerkDelete] = useState(false);

  const isDeletionInProgress = Boolean(deletionStatus?.inProgress);
  const canRetryDeletion = Boolean(deletionStatus?.retryable);

  useEffect(() => {
    if (!deletionStatus?.requested || isFinalizingDeletion) {
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
  ]);

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
          <Button variant="outline" onClick={() => signOut()}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
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
                <div className="rounded-md border border-muted bg-muted/30 p-3 space-y-2">
                  {deletionStatus.inProgress ? (
                    <p className="text-xs text-muted-foreground">
                      Backend cleanup is in progress at stage{" "}
                      <span className="font-medium text-foreground">
                        {deletionStatus.job?.stage ?? "pending"}
                      </span>
                      .
                    </p>
                  ) : null}

                  {deletionStatus.retryable ? (
                    <p className="text-xs text-destructive">
                      Cleanup failed.{" "}
                      {deletionStatus.job?.lastError ?? "Unknown error."}
                    </p>
                  ) : null}

                  {deletionStatus.canDeleteClerkAccount ? (
                    <p className="text-xs text-muted-foreground">
                      Cleanup complete. Finalizing account deletion now.
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
