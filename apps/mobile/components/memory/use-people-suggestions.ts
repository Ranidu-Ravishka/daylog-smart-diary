import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "convex/react";
import { api } from "@repo/backend/convex";
import { Alert } from "react-native";
import type { MemoryItem } from "@/components/memory/types";

export type IntegrationDailyDataForPeople = {
  signals?: string[];
  syncedAt: number;
  context?: {
    calendar?: {
      eventTitles?: string[];
    };
  };
};

export type SuggestedPerson = {
  key: string;
  name: string;
  avatarText: string;
  lastMetAt: number | null;
  relationContext: string;
  group: "frequent" | "recent" | "occasional";
  count: number;
};

type ContactsModuleLike = {
  requestPermissionsAsync: () => Promise<{ status: string }>;
  getContactsAsync: (params: {
    fields?: unknown[];
    pageSize?: number;
    pageOffset?: number;
  }) => Promise<{ data: { name?: string }[] }>;
  addContactAsync: (contact: { firstName: string }) => Promise<string>;
};

type UsePeopleSuggestionsParams = {
  isAuthenticated: boolean;
  peopleTags: string[];
  integrationDailyData: IntegrationDailyDataForPeople[];
  onMarkKnownPerson: (name: string) => Promise<void>;
};

const IGNORED_PEOPLE_STORAGE_KEY = "daylog.people_you_met.ignored.v1";
const CONTACT_CONSENT_STORAGE_KEY = "daylog.people_you_met.contact_consent.v1";
const MATCH_DEBOUNCE_MS = 220;

function normalizePersonName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function personKey(value: string): string {
  return normalizePersonName(value).toLowerCase();
}

function toInitials(value: string): string {
  const trimmed = normalizePersonName(value);
  if (!trimmed) return "?";
  const parts = trimmed.split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

function getSuggestionGroup(
  count: number,
  lastMetAt: number | null,
): "frequent" | "recent" | "occasional" {
  if (count >= 3) return "frequent";
  if (lastMetAt && Date.now() - lastMetAt <= 3 * 24 * 60 * 60 * 1000) {
    return "recent";
  }
  return "occasional";
}

function extractNameCandidatesFromText(value: string): string[] {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const split = normalized
    .split(/[,&/]| and | with /gi)
    .map((part) => normalizePersonName(part))
    .filter(Boolean);
  return split.filter((part) =>
    /^[A-Za-z][A-Za-z.'-]*(\s+[A-Za-z][A-Za-z.'-]*)*$/.test(part),
  );
}

function getContactsModule(): ContactsModuleLike | null {
  try {
    const dynamicRequire = Function("return require")() as (
      moduleName: string,
    ) => unknown;
    return dynamicRequire("expo-contacts") as ContactsModuleLike;
  } catch {
    return null;
  }
}

export function formatLastMetLabel(lastMetAt: number | null): string {
  if (!lastMetAt) return "Last met: unknown";
  return `Last met: ${new Date(lastMetAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

export function usePeopleSuggestions({
  isAuthenticated,
  peopleTags,
  integrationDailyData,
  onMarkKnownPerson,
}: UsePeopleSuggestionsParams) {
  const [recentPeopleRefreshToken] = React.useState(0);
  const [ignoredSuggestionKeys, setIgnoredSuggestionKeys] = React.useState<
    string[]
  >([]);
  const [contactConsentEnabled, setContactConsentEnabled] =
    React.useState(false);
  const [deviceContactNames, setDeviceContactNames] = React.useState<string[]>(
    [],
  );
  const [matchingDebounceTick, setMatchingDebounceTick] = React.useState(0);

  const recentMemoriesForPeople = useQuery(
    api.memories.listRecentMemories,
    isAuthenticated
      ? { limit: 100, refreshToken: recentPeopleRefreshToken }
      : "skip",
  ) as MemoryItem[] | undefined;

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [ignoredRaw, consentRaw] = await Promise.all([
          AsyncStorage.getItem(IGNORED_PEOPLE_STORAGE_KEY),
          AsyncStorage.getItem(CONTACT_CONSENT_STORAGE_KEY),
        ]);
        if (!active) return;
        const ignored = ignoredRaw ? (JSON.parse(ignoredRaw) as string[]) : [];
        setIgnoredSuggestionKeys(Array.isArray(ignored) ? ignored : []);
        setContactConsentEnabled(consentRaw === "1");
      } catch {
        if (!active) return;
        setIgnoredSuggestionKeys([]);
        setContactConsentEnabled(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setMatchingDebounceTick((value) => value + 1);
    }, MATCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    recentMemoriesForPeople,
    peopleTags,
    integrationDailyData,
    ignoredSuggestionKeys,
    contactConsentEnabled,
  ]);

  React.useEffect(() => {
    if (!contactConsentEnabled) {
      setDeviceContactNames([]);
      return;
    }
    let active = true;
    (async () => {
      const Contacts = getContactsModule();
      if (!Contacts) {
        if (active) setDeviceContactNames([]);
        return;
      }
      try {
        const permission = await Contacts.requestPermissionsAsync();
        if (permission.status !== "granted") {
          if (active) setDeviceContactNames([]);
          return;
        }
        const response = await Contacts.getContactsAsync({ pageSize: 500 });
        if (!active) return;
        const names = response.data
          .map((entry) => normalizePersonName(entry.name ?? ""))
          .filter(Boolean);
        setDeviceContactNames(Array.from(new Set(names)));
      } catch {
        if (active) setDeviceContactNames([]);
      }
    })();
    return () => {
      active = false;
    };
  }, [contactConsentEnabled]);

  const peopleSuggestions = React.useMemo(() => {
    void matchingDebounceTick;
    const sourceMemories = recentMemoriesForPeople ?? [];
    const candidates = new Map<
      string,
      {
        name: string;
        count: number;
        lastMetAt: number | null;
        contexts: Set<string>;
      }
    >();

    const upsertCandidate = (
      nameRaw: string,
      lastMetAt: number | null,
      context: string,
    ) => {
      const normalizedName = normalizePersonName(nameRaw);
      if (!normalizedName) return;
      const key = personKey(normalizedName);
      if (ignoredSuggestionKeys.includes(key)) return;
      const existing = candidates.get(key);
      if (!existing) {
        candidates.set(key, {
          name: normalizedName,
          count: 1,
          lastMetAt,
          contexts: new Set([context]),
        });
        return;
      }
      existing.count += 1;
      if (
        lastMetAt &&
        (!existing.lastMetAt || lastMetAt > existing.lastMetAt)
      ) {
        existing.lastMetAt = lastMetAt;
      }
      existing.contexts.add(context);
    };

    for (const person of peopleTags) {
      upsertCandidate(person, Date.now(), "manual day tag");
    }
    for (const memory of sourceMemories) {
      const metAt = memory.happenedAt ?? null;
      for (const person of memory.linkedPeople ?? []) {
        upsertCandidate(person, metAt, "memory link");
      }
      for (const detected of extractNameCandidatesFromText(
        memory.title ?? "",
      )) {
        upsertCandidate(detected, metAt, "memory title");
      }
      for (const detected of extractNameCandidatesFromText(
        memory.description ?? "",
      )) {
        upsertCandidate(detected, metAt, "memory description");
      }
    }
    for (const integrationEntry of integrationDailyData) {
      const titles = integrationEntry.context?.calendar?.eventTitles ?? [];
      for (const eventTitle of titles) {
        for (const detected of extractNameCandidatesFromText(eventTitle)) {
          upsertCandidate(
            detected,
            integrationEntry.syncedAt,
            "calendar event",
          );
        }
      }
      for (const signal of integrationEntry.signals ?? []) {
        for (const detected of extractNameCandidatesFromText(signal)) {
          upsertCandidate(
            detected,
            integrationEntry.syncedAt,
            "interaction signal",
          );
        }
      }
    }

    const contactKeySet = new Set(
      deviceContactNames.map((name) => personKey(name)),
    );
    return Array.from(candidates.entries())
      .map(([key, entry]) => {
        const hasDeviceContactMatch =
          contactConsentEnabled && contactKeySet.has(key);
        const relationContext = hasDeviceContactMatch
          ? "Matched from phone contacts"
          : entry.contexts.has("calendar event")
            ? "Suggested from calendar attendees"
            : entry.contexts.has("interaction signal")
              ? "Suggested from frequent interactions"
              : entry.contexts.has("memory link")
                ? "Suggested from linked memories"
                : "Suggested from activity logs";
        return {
          key,
          name: entry.name,
          avatarText: toInitials(entry.name),
          lastMetAt: entry.lastMetAt,
          relationContext,
          group: getSuggestionGroup(entry.count, entry.lastMetAt),
          count: entry.count,
        } satisfies SuggestedPerson;
      })
      .sort((left, right) => {
        const groupWeight = { frequent: 0, recent: 1, occasional: 2 };
        const weightDiff = groupWeight[left.group] - groupWeight[right.group];
        if (weightDiff !== 0) return weightDiff;
        return (right.lastMetAt ?? 0) - (left.lastMetAt ?? 0);
      });
  }, [
    contactConsentEnabled,
    deviceContactNames,
    ignoredSuggestionKeys,
    integrationDailyData,
    matchingDebounceTick,
    peopleTags,
    recentMemoriesForPeople,
  ]);

  const groupedSuggestions = React.useMemo(
    () => ({
      frequent: peopleSuggestions.filter((item) => item.group === "frequent"),
      recent: peopleSuggestions.filter((item) => item.group === "recent"),
      occasional: peopleSuggestions.filter(
        (item) => item.group === "occasional",
      ),
    }),
    [peopleSuggestions],
  );

  const persistIgnoredPeople = React.useCallback(async (keys: string[]) => {
    setIgnoredSuggestionKeys(keys);
    try {
      await AsyncStorage.setItem(
        IGNORED_PEOPLE_STORAGE_KEY,
        JSON.stringify(keys),
      );
    } catch {}
  }, []);

  const handleIgnoreSuggestion = React.useCallback(
    async (person: SuggestedPerson) => {
      if (ignoredSuggestionKeys.includes(person.key)) return;
      await persistIgnoredPeople([...ignoredSuggestionKeys, person.key]);
    },
    [ignoredSuggestionKeys, persistIgnoredPeople],
  );

  const handleMarkKnown = React.useCallback(
    async (person: SuggestedPerson) => {
      const exists = peopleTags.some(
        (value) => personKey(value) === person.key,
      );
      if (!exists) {
        await onMarkKnownPerson(person.name);
      }
      await handleIgnoreSuggestion(person);
    },
    [handleIgnoreSuggestion, onMarkKnownPerson, peopleTags],
  );

  const handleAddToContacts = React.useCallback(
    async (person: SuggestedPerson) => {
      const Contacts = getContactsModule();
      if (!Contacts) {
        Alert.alert(
          "Unavailable",
          "Contacts integration is not available in this build.",
        );
        return;
      }
      try {
        const permission = await Contacts.requestPermissionsAsync();
        if (permission.status !== "granted") {
          Alert.alert(
            "Permission required",
            "Allow contacts permission to add suggestions to contacts.",
          );
          return;
        }
        await Contacts.addContactAsync({ firstName: person.name });
        Alert.alert("Added", `${person.name} was added to your contacts.`);
        await handleIgnoreSuggestion(person);
      } catch {
        Alert.alert("Error", "Could not add this contact right now.");
      }
    },
    [handleIgnoreSuggestion],
  );

  const handleEnableContactMatching = React.useCallback(() => {
    Alert.alert(
      "Enable contact matching?",
      "DayLog will read contact names on this device to improve person suggestions. Raw contact details are never uploaded.",
      [
        { text: "Not now", style: "cancel" },
        {
          text: "Enable",
          onPress: async () => {
            setContactConsentEnabled(true);
            try {
              await AsyncStorage.setItem(CONTACT_CONSENT_STORAGE_KEY, "1");
            } catch {}
          },
        },
      ],
    );
  }, []);

  return {
    contactConsentEnabled,
    groupedSuggestions,
    handleAddToContacts,
    handleEnableContactMatching,
    handleIgnoreSuggestion,
    handleMarkKnown,
  };
}
