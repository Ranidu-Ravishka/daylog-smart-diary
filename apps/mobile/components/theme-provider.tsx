import AsyncStorage from "@react-native-async-storage/async-storage";
import { useConvexAuth, useQuery } from "convex/react";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import { api } from "@repo/backend/convex";
import {
  normalizeUserSettings,
  type UserSettingsTheme,
} from "@repo/user-settings/lib/user-settings";
import { Colors, type ThemeColors } from "@/constants/theme";

type EffectiveTheme = "light" | "dark";

type AppThemeContextValue = {
  preference: UserSettingsTheme;
  setThemePreference: (nextPreference: UserSettingsTheme) => void;
  effectiveTheme: EffectiveTheme;
  isDark: boolean;
  colors: ThemeColors;
};

const APP_THEME_STORAGE_KEY = "daylog.theme.preference";

export const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function isThemePreference(value: string | null): value is UserSettingsTheme {
  return value === "light" || value === "dark" || value === "system";
}

function resolveEffectiveTheme(
  preference: UserSettingsTheme,
  systemTheme: EffectiveTheme,
): EffectiveTheme {
  if (preference === "system") {
    return systemTheme;
  }

  return preference;
}

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const userPreferences = useQuery(
    api.userPreferences.getMyUserPreferences,
    isAuthenticated ? {} : "skip",
  );

  const [localPreference, setLocalPreference] =
    useState<UserSettingsTheme>("system");
  const [hasLoadedStoredPreference, setHasLoadedStoredPreference] =
    useState(false);

  const systemTheme: EffectiveTheme =
    useColorScheme() === "dark" ? "dark" : "light";

  const backendThemePreference: UserSettingsTheme | null = useMemo(() => {
    if (!isAuthenticated || userPreferences === undefined) {
      return null;
    }

    return normalizeUserSettings(userPreferences).theme;
  }, [isAuthenticated, userPreferences]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const storedPreference = await AsyncStorage.getItem(
          APP_THEME_STORAGE_KEY,
        );
        if (!cancelled && isThemePreference(storedPreference)) {
          setLocalPreference(storedPreference);
        }
      } finally {
        if (!cancelled) {
          setHasLoadedStoredPreference(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!backendThemePreference) {
      return;
    }

    setLocalPreference((currentPreference) =>
      currentPreference === backendThemePreference
        ? currentPreference
        : backendThemePreference,
    );
  }, [backendThemePreference]);

  useEffect(() => {
    if (!hasLoadedStoredPreference) {
      return;
    }

    void AsyncStorage.setItem(APP_THEME_STORAGE_KEY, localPreference).catch(
      () => {
        // Keep runtime theming functional even if persistence fails.
      },
    );
  }, [hasLoadedStoredPreference, localPreference]);

  const setThemePreference = useCallback(
    (nextPreference: UserSettingsTheme) => {
      setLocalPreference((currentPreference) =>
        currentPreference === nextPreference
          ? currentPreference
          : nextPreference,
      );
    },
    [],
  );

  const preference = backendThemePreference ?? localPreference;
  const effectiveTheme = resolveEffectiveTheme(preference, systemTheme);

  const contextValue = useMemo<AppThemeContextValue>(
    () => ({
      preference,
      setThemePreference,
      effectiveTheme,
      isDark: effectiveTheme === "dark",
      colors: Colors[effectiveTheme],
    }),
    [effectiveTheme, preference, setThemePreference],
  );

  return (
    <AppThemeContext.Provider value={contextValue}>
      {children}
    </AppThemeContext.Provider>
  );
}

export function useAppTheme(): AppThemeContextValue {
  const context = useContext(AppThemeContext);

  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }

  return context;
}
