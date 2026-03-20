"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";

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
      const id = Math.random().toString(36).substr(2, 9);

      setToasts((prev) => [...prev, { id, message, type }]);

      // Auto-remove after 3 seconds
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3000);
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
      {/* Toast Container */}
      <div className="fixed bottom-0 right-0 z-50 flex flex-col gap-2 p-4 max-w-sm">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg animate-in slide-in-from-right-full ${
              toast.type === "success"
                ? "bg-green-50 text-green-900 border border-green-200"
                : toast.type === "error"
                  ? "bg-red-50 text-red-900 border border-red-200"
                  : "bg-blue-50 text-blue-900 border border-blue-200"
            }`}
          >
            <span className="flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
