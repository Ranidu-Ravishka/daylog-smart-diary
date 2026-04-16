import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { Appearance, View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { AppThemeContext } from "@/components/theme-provider";
import { AppButton } from "@/components/ui/app-button";
import { captureException } from "@/lib/observability";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  static contextType = AppThemeContext;
  declare context: React.ContextType<typeof AppThemeContext>;

  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException("mobile_error_boundary_caught", error, {
      componentStack: info.componentStack,
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    const fallbackTheme =
      Appearance.getColorScheme() === "dark" ? "dark" : "light";
    const c = this.context?.colors ?? Colors[fallbackTheme];
    const styles = createStyles(c);

    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <View style={styles.container}>
          <View style={styles.iconCircle}>
            <Ionicons name="warning-outline" size={32} color={c.error} />
          </View>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.subtitle}>
            An unexpected error occurred. Please try again.
          </Text>
          <AppButton
            title="Try Again"
            onPress={this.handleRetry}
            size="md"
            style={{ marginTop: Spacing.xl }}
          />
        </View>
      );
    }

    return this.props.children;
  }
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: Spacing["3xl"],
      backgroundColor: c.background,
    },
    iconCircle: {
      width: 64,
      height: 64,
      borderRadius: 32,
      backgroundColor: c.errorLight,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing.xl,
    },
    title: {
      ...Typography.title3,
      color: c.text,
      textAlign: "center",
      marginBottom: Spacing.sm,
    },
    subtitle: {
      ...Typography.callout,
      color: c.textSecondary,
      textAlign: "center",
      maxWidth: 260,
      lineHeight: 20,
    },
  });
}
