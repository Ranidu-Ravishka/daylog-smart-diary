import { MEMORY_MOOD_VALUES } from "@repo/user-settings/lib/user-settings";

type MoodOption = {
  value: string;
  label: string;
  emoji: string;
};

export const MOOD_LABELS: Record<string, string> = {
  happy: "Happy",
  peaceful: "Peaceful",
  excited: "Excited",
  loved: "Loved",
  sad: "Sad",
  angry: "Angry",
  anxious: "Anxious",
  neutral: "Neutral",
};

export const MOOD_EMOJI: Record<string, string> = {
  happy: "😊",
  peaceful: "😌",
  excited: "🎉",
  loved: "❤️",
  sad: "😢",
  angry: "😤",
  anxious: "😰",
  neutral: "😐",
};

export const MOOD_OPTIONS: MoodOption[] = MEMORY_MOOD_VALUES.map((value) => ({
  value,
  label: MOOD_LABELS[value] ?? value,
  emoji: MOOD_EMOJI[value] ?? "😐",
}));

export const MOODS: string[] = MOOD_OPTIONS.map((option) => option.value);
