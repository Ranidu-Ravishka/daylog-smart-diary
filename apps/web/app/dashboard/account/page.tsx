"use client";

import { useUser, useClerk } from "@clerk/nextjs";
import { useState } from "react";
import { LogOut, AlertTriangle } from "lucide-react";
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
import { toastError, toastSuccess } from "@/lib/toast";

export default function AccountPage() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    if (confirmText !== "DELETE") return;
    setIsDeleting(true);
    try {
      await user?.delete();
      await signOut();
      toastSuccess("Account deleted successfully.");
    } catch (err) {
      console.error("Failed to delete account:", err);
      toastError("Failed to delete account. Please try again.");
      setIsDeleting(false);
    }
  };

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
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteAccount}
                  disabled={confirmText !== "DELETE" || isDeleting}
                >
                  {isDeleting ? "Deleting…" : "Permanently delete"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowConfirm(false);
                    setConfirmText("");
                  }}
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
