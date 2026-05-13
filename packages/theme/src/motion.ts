export const DAYLOG_EASE = [0.22, 1, 0.36, 1] as const;

export type DaylogEasing = typeof DAYLOG_EASE;

export function daylogFadeTransition(delay = 0) {
  return {
    duration: 0.55,
    delay,
    ease: [...DAYLOG_EASE] as [number, number, number, number],
  };
}
