/**
 * Extract candidate person names from free-form text.
 *
 * The previous implementation in `use-people-suggestions.ts` simply split on
 * the substrings ` and `, ` with `, `,`, `&`, `/` and accepted any
 * Latin-letter word(s) as a name. That made `"talking with my school mates"`
 * yield `["talking", "my school mates"]` — both of which are not real people.
 *
 * High-precision extraction strategy:
 *
 *   1. Normalize delimiters and tokenize on whitespace.
 *   2. Walk the tokens, collecting *runs of consecutive capitalized,
 *      name-shaped tokens that are NOT in our stop-word list*. A run flushes
 *      the moment it hits a non-name token (lowercase word, punctuation,
 *      digits) OR a stop-word like "Saw" / "Lunch" / "Friends".
 *   3. Each flushed run becomes a candidate ("Mary Jane", "Bob Smith",
 *      "Alice", "Anne-Marie", "St. John").
 *   4. Final candidates are deduped (case-insensitive) preserving original
 *      casing of the first occurrence.
 *
 * The goal is to miss possible names rather than to falsely surface
 * common verbs / event nouns / generic group words as people.
 */

const NAME_TOKEN = /^[A-Z][A-Za-z'.-]*$/;

/**
 * Words that look capitalized but are never names — verbs, generic nouns,
 * meal/event types, weekdays, months, generic group words.
 *
 * Compared lower-cased so "Lunch" / "lunch" / "LUNCH" all reject.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  // common verbs and verb gerunds
  "saw",
  "met",
  "see",
  "seeing",
  "meeting",
  "called",
  "calling",
  "texted",
  "texting",
  "messaged",
  "messaging",
  "talked",
  "talking",
  "spoke",
  "speaking",
  "chatted",
  "chatting",
  "had",
  "having",
  "got",
  "getting",
  "did",
  "doing",
  "made",
  "making",
  "went",
  "going",
  "came",
  "coming",
  "left",
  "leaving",
  "started",
  "starting",
  "finished",
  "finishing",
  "watched",
  "watching",
  "played",
  "playing",
  "worked",
  "working",
  "studied",
  "studying",
  "learned",
  "learning",
  "trained",
  "training",
  "ran",
  "running",
  "walked",
  "walking",
  "drove",
  "driving",
  "biked",
  "biking",
  "cycled",
  "cycling",
  "traveled",
  "travelled",
  "traveling",
  "travelling",
  "shopped",
  "shopping",
  "ate",
  "eating",
  "dined",
  "dining",
  "drank",
  "drinking",
  "discussed",
  "discussing",
  "argued",
  "arguing",
  "laughed",
  "laughing",
  "joked",
  "joking",
  "celebrated",
  "celebrating",
  "partied",
  "partying",
  "spent",
  "spending",
  "sat",
  "sitting",
  "slept",
  "sleeping",
  "rested",
  "resting",
  "relaxed",
  "relaxing",
  "hung",
  "hanging",
  "facetimed",
  "facetiming",
  "zoomed",
  "zooming",
  // event / meal / context nouns
  "lunch",
  "dinner",
  "breakfast",
  "brunch",
  "snack",
  "snacks",
  "meal",
  "meals",
  "food",
  "dessert",
  "drinks",
  "coffee",
  "tea",
  "espresso",
  "cocktails",
  "beers",
  "wine",
  "meeting",
  "meetings",
  "call",
  "calls",
  "standup",
  "standups",
  "meetup",
  "meetups",
  "hangout",
  "hangouts",
  "party",
  "parties",
  "event",
  "events",
  "date",
  "dates",
  "appointment",
  "appointments",
  "session",
  "sessions",
  "class",
  "classes",
  "workshop",
  "workshops",
  "conference",
  "trip",
  "trips",
  "outing",
  "outings",
  "errand",
  "errands",
  "review",
  "reviews",
  "interview",
  "interviews",
  "demo",
  "demos",
  "sync",
  "syncs",
  "checkin",
  "check-in",
  "1:1",
  "one-on-one",
  // time words
  "today",
  "tomorrow",
  "yesterday",
  "tonight",
  "morning",
  "afternoon",
  "evening",
  "night",
  "noon",
  "midnight",
  "weekend",
  "weekday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  // determiners / generic group nouns / pronouns
  "the",
  "a",
  "an",
  "my",
  "our",
  "your",
  "his",
  "her",
  "their",
  "this",
  "that",
  "these",
  "those",
  "some",
  "few",
  "many",
  "any",
  "every",
  "all",
  "no",
  "yes",
  "maybe",
  "people",
  "person",
  "team",
  "teammate",
  "teammates",
  "mate",
  "mates",
  "schoolmate",
  "schoolmates",
  "classmate",
  "classmates",
  "colleague",
  "colleagues",
  "coworker",
  "coworkers",
  "co-worker",
  "co-workers",
  "friend",
  "friends",
  "buddy",
  "buddies",
  "family",
  "families",
  "parent",
  "parents",
  "kid",
  "kids",
  "child",
  "children",
  "sibling",
  "siblings",
  "cousin",
  "cousins",
  "neighbor",
  "neighbors",
  "neighbour",
  "neighbours",
  "everyone",
  "someone",
  "anyone",
  "nobody",
  "guys",
  "gals",
  "ladies",
  "gentlemen",
  "boys",
  "girls",
  // common short prepositions / conjunctions that survive cleaning
  "for",
  "from",
  "to",
  "at",
  "in",
  "on",
  "by",
  "of",
  "near",
  "around",
  "about",
  "into",
  "onto",
  "out",
  "over",
  "under",
  "and",
  "with",
  "or",
  "but",
  "if",
  "when",
  "while",
  "after",
  "before",
]);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isStopword(token: string): boolean {
  return STOPWORDS.has(token.toLowerCase());
}

function isNameToken(token: string): boolean {
  return NAME_TOKEN.test(token);
}

/**
 * Extract candidate person names from a free-form sentence.
 *
 * Returns capitalized name-like sequences that survive a comprehensive
 * verb / event-noun / generic-noun stop-list. Multi-word names ("Mary Jane",
 * "Bob Smith", "Anne-Marie") are returned as a single entry. Duplicates are
 * collapsed case-insensitively, preserving the first-seen casing.
 */
export function extractNameCandidatesFromText(value: string): string[] {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return [];

  // Replace common in-line delimiters with a sentinel token (`|`). The
  // sentinel is not a NAME_TOKEN, so the walk below will treat it as a
  // flush boundary — preventing "Alice, Bob, Carol" from collapsing into a
  // single multi-word run.
  const cleaned = normalized.replace(/[,&/;|()[\]"]/g, " | ");
  const tokens = cleaned.split(/\s+/).filter(Boolean);

  const runs: string[] = [];
  let current: string[] = [];

  const flush = () => {
    if (current.length === 0) return;
    runs.push(current.join(" "));
    current = [];
  };

  for (const token of tokens) {
    if (isNameToken(token) && !isStopword(token)) {
      current.push(token);
      continue;
    }
    flush();
  }
  flush();

  if (runs.length === 0) return [];

  const seen = new Set<string>();
  const accepted: string[] = [];
  for (const run of runs) {
    const key = run.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push(run);
  }
  return accepted;
}
