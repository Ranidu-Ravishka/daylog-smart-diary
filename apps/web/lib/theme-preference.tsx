"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@repo/backend/convex";
import {
  normalizeUserSettings,
  type UserSettingsTheme,
} from "@repo/user-settings/lib/user-settings";

type ResolvedTheme = "light" | "dark";

type ThemePreferenceContextValue = {
  themePreference: UserSettingsTheme;
  setThemePreference: (nextPreference: UserSettingsTheme) => void;
  resolvedTheme: ResolvedTheme;
};

const THEME_STORAGE_KEY = "daylog.theme.preference";

const ThemePreferenceContext =
  createContext<ThemePreferenceContextValue | null>(null);

function isThemePreference(value: string | null): value is UserSettingsTheme {
  return value === "light" || value === "dark" || value === "system";
}

function resolveTheme(
  themePreference: UserSettingsTheme,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (themePreference === "system") {
    return systemPrefersDark ? "dark" : "light";
  }

  return themePreference;
}

export function ThemePreferenceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [themePreference, setThemePreferenceState] =
    useState<UserSettingsTheme>("system");
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);
  const [hasLoadedStorage, setHasLoadedStorage] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(storedPreference)) {
      setThemePreferenceState(storedPreference);
    }

    setHasLoadedStorage(true);
  }, []);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemPreference = () => {
      setSystemPrefersDark(mediaQuery.matches);
    };

    applySystemPreference();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", applySystemPreference);

      return () => {
        mediaQuery.removeEventListener("change", applySystemPreference);
      };
    }

    mediaQuery.addListener(applySystemPreference);
    return () => {
      mediaQuery.removeListener(applySystemPreference);
    };
  }, []);

  const resolvedTheme = useMemo(
    () => resolveTheme(themePreference, systemPrefersDark),
    [systemPrefersDark, themePreference],
  );

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const root = document.documentElement;
    root.classList.toggle("dark", resolvedTheme === "dark");
    root.style.colorScheme = resolvedTheme;
    root.dataset.themePreference = themePreference;
  }, [resolvedTheme, themePreference]);

  useEffect(() => {
    if (!hasLoadedStorage || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(THEME_STORAGE_KEY, themePreference);
  }, [hasLoadedStorage, themePreference]);

  const setThemePreference = useCallback(
    (nextPreference: UserSettingsTheme) => {
      setThemePreferenceState((currentPreference) =>
        currentPreference === nextPreference
          ? currentPreference
          : nextPreference,
      );
    },
    [],
  );

  const contextValue = useMemo<ThemePreferenceContextValue>(
    () => ({
      themePreference,
      setThemePreference,
      resolvedTheme,
    }),
    [resolvedTheme, setThemePreference, themePreference],
  );

  return (
    <ThemePreferenceContext.Provider value={contextValue}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function ThemePreferenceSyncFromBackend() {
  const { isAuthenticated } = useConvexAuth();
  const preferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );
  const { setThemePreference } = useWebThemePreference();

  useEffect(() => {
    if (!isAuthenticated || preferences === undefined) {
      return;
    }

    const backendPreference = normalizeUserSettings(preferences).theme;
    setThemePreference(backendPreference);
  }, [isAuthenticated, preferences, setThemePreference]);

  return null;
}

export function useWebThemePreference(): ThemePreferenceContextValue {
  const context = useContext(ThemePreferenceContext);

  if (!context) {
    throw new Error(
      "useWebThemePreference must be used within ThemePreferenceProvider",
    );
  }

  return context;
}
