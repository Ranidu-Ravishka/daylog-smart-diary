"use client";

import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface DashboardDatePickerProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

function formatLongDate(date: Date) {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getWeekContext(date: Date) {
  const start = new Date(date);
  start.setDate(date.getDate() - date.getDay());
  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  const startLabel = start.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const endLabel = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const monthLabel = date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return `Week ${startLabel} – ${endLabel} · ${monthLabel}`;
}

export function DashboardDatePicker({
  selectedDate,
  onSelectDate,
}: DashboardDatePickerProps) {
  const today = new Date();
  const isToday = selectedDate.toDateString() === today.toDateString();

  const handleDayChange = (offset: number) => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + offset);
    if (next <= today) {
      onSelectDate(next);
    }
  };

  return (
    <Card className="mb-8">
      <CardContent className="p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleDayChange(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold tracking-tight">
              {formatLongDate(selectedDate)}
            </h1>
            <p className="text-xs text-muted-foreground">
              {isToday ? "Today" : getWeekContext(selectedDate)}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => handleDayChange(1)}
            disabled={isToday}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            onClick={() => onSelectDate(today)}
            disabled={isToday}
          >
            Today
          </Button>
        </div>

        <div className="mt-4 rounded-md border border-border p-3">
          <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays className="h-4 w-4" />
            Pick a date
          </div>
          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              if (date && date <= today) {
                onSelectDate(date);
              }
            }}
            disabled={{ after: today }}
            showOutsideDays
          />
        </div>
      </CardContent>
    </Card>
  );
}
