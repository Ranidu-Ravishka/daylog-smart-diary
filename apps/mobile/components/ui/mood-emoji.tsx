import React from "react";
import { MOOD_LABELS } from "@repo/ui/lib/constants";
import { TwemojiSvg, type TwemojiCodepoint } from "./twemoji-svg";

const MOOD_TO_CODEPOINT: Record<string, TwemojiCodepoint> = {
  happy: "1f60a",
  peaceful: "1f60c",
  excited: "1f389",
  loved: "2764",
  sad: "1f622",
  angry: "1f624",
  anxious: "1f630",
  neutral: "1f610",
};

const NEUTRAL_CODEPOINT: TwemojiCodepoint = "1f610";

export type MoodEmojiProps = {
  mood?: string | null;
  size?: number;
  accessibilityLabel?: string;
  fallback?: "neutral" | "none";
};

function MoodEmojiComponent({
  mood,
  size = 24,
  accessibilityLabel,
  fallback = "neutral",
}: MoodEmojiProps) {
  const codepoint = mood ? MOOD_TO_CODEPOINT[mood] : undefined;

  if (!codepoint) {
    if (fallback === "none") {
      return null;
    }
    return (
      <TwemojiSvg
        codepoint={NEUTRAL_CODEPOINT}
        size={size}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }

  const resolvedLabel =
    accessibilityLabel ??
    (mood ? `${MOOD_LABELS[mood] ?? mood} mood` : undefined);

  return (
    <TwemojiSvg
      codepoint={codepoint}
      size={size}
      accessibilityLabel={resolvedLabel}
    />
  );
}

export const MoodEmoji = React.memo(MoodEmojiComponent);
