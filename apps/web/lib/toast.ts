// Simple toast notification utility
type ToastType = "success" | "error" | "info";

export function showToast(message: string, type: ToastType = "success") {
  // Create a custom event that can be listened to by a Toast provider
  const event = new CustomEvent("toast", {
    detail: { message, type },
  });
  window.dispatchEvent(event);
}

export function toastSuccess(message: string) {
  showToast(message, "success");
}

export function toastError(message: string) {
  showToast(message, "error");
}

export function toastInfo(message: string) {
  showToast(message, "info");
}
