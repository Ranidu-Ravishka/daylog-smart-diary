"use client";

import { useQuery, useMutation, useConvexAuth } from "convex/react";
import { api } from "@repo/backend/convex";
import { useUser } from "@clerk/nextjs";
import { useState, useEffect } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const FOCUS_AREAS = [
  { id: 0, label: "Mental Health" },
  { id: 1, label: "Productivity" },
  { id: 2, label: "Relationships" },
  { id: 3, label: "Fitness" },
  { id: 4, label: "Creativity" },
];

function LoadingSkeleton() {
  return (
    <div className="max-w-xl space-y-6">
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-24" />
      <Skeleton className="h-32" />
      <Skeleton className="h-32" />
    </div>
  );
}

export default function SettingsPage() {
  const { isAuthenticated, isLoading: isAuthLoading } = useConvexAuth();
  const { user } = useUser();

  const preferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );

  const syncPreferences = useMutation(
    api.userPreferences.syncMyUserPreferences,
  );

  const [selectedFocus, setSelectedFocus] = useState<number[]>([]);
  const [reminderType, setReminderType] = useState<"daily" | "weekly">("daily");
  const [dailyTime, setDailyTime] = useState("20:00");
  const [weeklyDay, setWeeklyDay] = useState("Sunday");
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (preferences) {
      setSelectedFocus(preferences.focusAreas ?? []);
      setReminderType(preferences.reminderType ?? "daily");
      setWeeklyDay(preferences.weeklyDay ?? "Sunday");

      const parsed = new Date(preferences.dailyTime);
      if (!Number.isNaN(parsed.getTime())) {
        const h = String(parsed.getHours()).padStart(2, "0");
        const m = String(parsed.getMinutes()).padStart(2, "0");
        setDailyTime(`${h}:${m}`);
      }
    }
  }, [preferences]);

  const isLoading =
    isAuthLoading || (isAuthenticated && preferences === undefined);

  if (isLoading) return <LoadingSkeleton />;

  const handleSave = async () => {
    setIsSaving(true);
    setSaved(false);
    try {
      const [h, m] = dailyTime.split(":").map(Number);
      const timeDate = new Date();
      timeDate.setHours(h!, m!, 0, 0);

      const fmtH = h! % 12 || 12;
      const ampm = h! >= 12 ? "PM" : "AM";
      const formattedTime = `${fmtH}:${String(m).padStart(2, "0")} ${ampm}`;

      await syncPreferences({
        focusAreas: selectedFocus,
        reminderType,
        dailyTime: timeDate.toISOString(),
        weeklyDay,
        formattedTime,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save preferences:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleFocus = (id: number) => {
    setSelectedFocus((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id],
    );
  };

  const weekDays = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];

  return (
    <div className="max-w-xl">
      <h1 className="text-xl font-semibold tracking-tight mb-1">Settings</h1>
      <p className="text-sm text-muted-foreground mb-8">
        Manage your preferences and reflection schedule.
      </p>

      {/* ── Profile ───────────────────────────────────── */}
      <Card className="mb-6">
        <CardContent className="p-5 flex items-center gap-4">
          <Avatar className="h-12 w-12">
            {user?.imageUrl && (
              <AvatarImage src={user.imageUrl} alt="Profile" />
            )}
            <AvatarFallback>
              {user?.firstName?.[0]}
              {user?.lastName?.[0]}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-muted-foreground">
              {user?.primaryEmailAddress?.emailAddress}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* ── Focus Areas ───────────────────────────────── */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Focus Areas</CardTitle>
          <CardDescription>Choose what matters most to you.</CardDescription>
        </CardHeader>
        <CardContent className="pb-5">
          <div className="flex flex-wrap gap-2">
            {FOCUS_AREAS.map((area) => {
              const isActive = selectedFocus.includes(area.id);
              return (
                <button
                  key={area.id}
                  onClick={() => toggleFocus(area.id)}
                  className={cn(
                    "inline-flex items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "border-foreground bg-foreground text-background"
                      : "border-input text-muted-foreground hover:text-foreground hover:border-foreground",
                  )}
                >
                  {area.label}
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* ── Reminders ─────────────────────────────────── */}
      <Card className="mb-8">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Reminders</CardTitle>
          <CardDescription>
            Set when you want to be reminded to reflect.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 pb-5">
          <div className="flex gap-2">
            <Button
              variant={reminderType === "daily" ? "default" : "outline"}
              size="sm"
              onClick={() => setReminderType("daily")}
            >
              Daily
            </Button>
            <Button
              variant={reminderType === "weekly" ? "default" : "outline"}
              size="sm"
              onClick={() => setReminderType("weekly")}
            >
              Weekly
            </Button>
          </div>

          {reminderType === "daily" && (
            <div className="space-y-1.5">
              <Label htmlFor="time">Time</Label>
              <Input
                id="time"
                type="time"
                value={dailyTime}
                onChange={(e) => setDailyTime(e.target.value)}
                className="max-w-40"
              />
            </div>
          )}

          {reminderType === "weekly" && (
            <div className="space-y-1.5">
              <Label>Day</Label>
              <Select value={weeklyDay} onValueChange={setWeeklyDay}>
                <SelectTrigger className="max-w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weekDays.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Save ──────────────────────────────────────── */}
      <Button onClick={handleSave} disabled={isSaving}>
        {isSaving ? (
          "Saving…"
        ) : saved ? (
          <>
            <Check className="h-4 w-4" />
            Saved
          </>
        ) : (
          "Save preferences"
        )}
      </Button>
    </div>
  );
}
