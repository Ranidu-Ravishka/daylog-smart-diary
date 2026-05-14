"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = {
  id: string;
  message: string;
  type: "success" | "error" | "info";
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const handleToast = (event: Event) => {
      const customEvent = event as CustomEvent;
      const { message, type } = customEvent.detail;
      const id = Math.random().toString(36).slice(2, 11);

      setToasts((prev) => [...prev, { id, message, type }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4000);
    };

    window.addEventListener("toast", handleToast);
    return () => window.removeEventListener("toast", handleToast);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <>
      {children}
      <div
        className="fixed bottom-0 right-0 z-[100] flex max-w-sm flex-col gap-2 p-4 sm:p-5"
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm font-medium shadow-soft backdrop-blur-md",
              toast.type === "success" &&
                "border-success/25 bg-success/12 text-foreground dark:bg-success/16",
              toast.type === "error" &&
                "border-destructive/30 bg-destructive/12 text-foreground dark:bg-destructive/18",
              toast.type === "info" &&
                "border-info/25 bg-info/12 text-foreground dark:bg-info/16",
            )}
          >
            <span className="flex-1 leading-snug">{toast.message}</span>
            <button
              type="button"
              onClick={() => removeToast(toast.id)}
              className="shrink-0 rounded-md p-1 text-current opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
