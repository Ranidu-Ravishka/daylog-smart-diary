/** Time label for timeline rows (device-local). */
export function formatTimelineTime(timestamp: number): string {
  const d = new Date(timestamp);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}
