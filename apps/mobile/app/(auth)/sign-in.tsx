import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth, useOAuth, useSignIn, useSignUp } from "@clerk/clerk-expo";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  Colors,
  Radius,
  Shadows,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";

WebBrowser.maybeCompleteAuthSession();

type FocusedField = "email" | "password" | null;

export default function SignInScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { signUp } = useSignUp();

  const { startOAuthFlow: startGoogleOAuth } = useOAuth({
    strategy: "oauth_google",
  });
  const { startOAuthFlow: startAppleOAuth } = useOAuth({
    strategy: "oauth_apple",
  });

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showVerificationMessage, setShowVerificationMessage] = useState(false);
  const [focusedField, setFocusedField] = useState<FocusedField>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace("/quick-setup");
    }
  }, [authLoaded, isSignedIn, router]);

  const isDisabled = useMemo(() => {
    return (
      !emailAddress.trim() || password.length < 8 || !isLoaded || isPending
    );
  }, [emailAddress, password, isLoaded, isPending]);

  const handleOAuthSignIn = async (
    strategy: "oauth_google" | "oauth_apple",
  ) => {
    const startOAuthFlow =
      strategy === "oauth_google" ? startGoogleOAuth : startAppleOAuth;

    if (!isLoaded) return;

    setIsPending(true);
    setErrorMessage(null);
    setShowVerificationMessage(false);

    try {
      const oauthResult = await startOAuthFlow();

      if (oauthResult?.createdSessionId) {
        if (setActive) {
          await setActive({ session: oauthResult.createdSessionId });
        }
        router.replace("/quick-setup");
      } else {
        setErrorMessage("OAuth sign-in did not complete. Please try again.");
      }
    } catch (err) {
      if (err instanceof Error) {
        setErrorMessage(err.message);
      } else {
        setErrorMessage("Something went wrong during authentication");
      }
    } finally {
      setIsPending(false);
    }
  };

  const triggerEmailVerification = async () => {
    try {
      if (signUp) {
        await signUp.create({
          emailAddress: emailAddress.trim(),
        });

        await signUp.prepareEmailAddressVerification({
          strategy: "email_code",
        });

        setShowVerificationMessage(true);
        setErrorMessage("Verification email sent! Please check your inbox.");
      }
    } catch {
      setErrorMessage(
        "Unable to send verification email. Please contact support.",
      );
    }
  };

  const handleSignIn = async () => {
    if (!isLoaded) return;

    setIsPending(true);
    setErrorMessage(null);
    setShowVerificationMessage(false);

    try {
      const result = await signIn.create({
        identifier: emailAddress.trim(),
        password,
      });

      if (result.status === "complete") {
        if (setActive) {
          await setActive({ session: result.createdSessionId });
        }
        router.replace("/quick-setup");
      } else if (result.status === "needs_first_factor") {
        if (
          result.firstFactorVerification?.strategy === "email_link" ||
          result.firstFactorVerification?.strategy === "email_code"
        ) {
          setShowVerificationMessage(true);
          setErrorMessage(
            "Verification email sent! Please check your inbox and click the verification link.",
          );
        } else {
          setErrorMessage("Additional verification required.");
        }
      } else if (result.status === "needs_second_factor") {
        setErrorMessage("Two-factor authentication required.");
      } else if (result.status === "needs_new_password") {
        setErrorMessage(
          "Password reset required. Please use 'Forgot Password'.",
        );
      } else {
        setErrorMessage("Unable to complete sign in. Please try again.");
      }
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null) {
        if ("errors" in error) {
          const clerkError = error as {
            errors?: {
              message?: string;
              code?: string;
            }[];
          };

          const errorMsg =
            clerkError.errors?.[0]?.message ?? "Unable to sign in.";
          const errorCode = clerkError.errors?.[0]?.code;

          if (errorCode === "form_identifier_not_found") {
            setErrorMessage("No account found with this email.");
          } else if (errorCode === "form_password_incorrect") {
            setErrorMessage("Incorrect password.");
          } else if (
            errorMsg.includes("email") ||
            errorMsg.includes("verify")
          ) {
            await triggerEmailVerification();
          } else {
            setErrorMessage(errorMsg);
          }
        } else if ("message" in error) {
          setErrorMessage((error as { message: string }).message);
        }
      } else {
        setErrorMessage("Unable to sign in. Please try again.");
      }
    } finally {
      setIsPending(false);
    }
  };

  const resendVerificationEmail = async () => {
    if (!signUp) return;

    setIsPending(true);
    try {
      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });
      setErrorMessage("Verification email resent! Please check your inbox.");
    } catch {
      setErrorMessage("Unable to resend verification email.");
    } finally {
      setIsPending(false);
    }
  };

  if (!authLoaded || (authLoaded && isSignedIn)) {
    return (
      <View
        style={[styles.loaderContainer, { backgroundColor: colors.background }]}
      >
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.flex, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <Animated.View
            entering={FadeInDown.duration(220)}
            style={styles.header}
          >
            <View
              style={[styles.logoWrap, { backgroundColor: colors.tintLight }]}
            >
              <Image
                source={require("@/assets/images/logo.png")}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
            <Text style={[styles.title, { color: colors.text }]}>
              Welcome back
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              Sign in to continue your day story.
            </Text>
          </Animated.View>

          <Animated.View
            entering={FadeInDown.delay(60).duration(220)}
            style={styles.socialButtonsContainer}
          >
            <Pressable
              style={({ pressed }) => [
                styles.socialButton,
                styles.googleButton,
                { opacity: isPending ? 0.6 : pressed ? 0.92 : 1 },
              ]}
              onPress={() => handleOAuthSignIn("oauth_google")}
              disabled={isPending}
            >
              <Ionicons
                name="logo-google"
                size={18}
                color={colors.inverseText}
              />
              <Text style={styles.socialButtonText}>Continue with Google</Text>
            </Pressable>

            {Platform.OS === "ios" ? (
              <Pressable
                style={({ pressed }) => [
                  styles.socialButton,
                  styles.appleButton,
                  { opacity: isPending ? 0.6 : pressed ? 0.92 : 1 },
                ]}
                onPress={() => handleOAuthSignIn("oauth_apple")}
                disabled={isPending}
              >
                <Ionicons
                  name="logo-apple"
                  size={18}
                  color={colors.inverseText}
                />
                <Text style={styles.socialButtonText}>Continue with Apple</Text>
              </Pressable>
            ) : null}
          </Animated.View>

          <View style={styles.divider}>
            <View
              style={[styles.dividerLine, { backgroundColor: colors.border }]}
            />
            <Text style={[styles.dividerText, { color: colors.textTertiary }]}>
              OR
            </Text>
            <View
              style={[styles.dividerLine, { backgroundColor: colors.border }]}
            />
          </View>

          <Animated.View
            entering={FadeInDown.delay(120).duration(220)}
            style={[
              styles.card,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                shadowColor: colors.cardShadow,
              },
            ]}
          >
            <View style={styles.fieldGroup}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                Email address
              </Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    borderColor:
                      focusedField === "email" ? colors.tint : colors.border,
                    backgroundColor: colors.inputBg,
                    color: colors.text,
                  },
                ]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="name@example.com"
                placeholderTextColor={colors.textTertiary}
                value={emailAddress}
                onChangeText={(text) => {
                  setEmailAddress(text);
                  setErrorMessage(null);
                  setShowVerificationMessage(false);
                }}
                onFocus={() => setFocusedField("email")}
                onBlur={() => setFocusedField(null)}
                textContentType="emailAddress"
                autoFocus
                editable={!isPending}
              />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.passwordHeader}>
                <Text style={[styles.label, { color: colors.textSecondary }]}>
                  Password
                </Text>
                <Pressable onPress={() => router.push("/forgot-password")}>
                  <Text
                    style={[styles.forgotPasswordText, { color: colors.tint }]}
                  >
                    Forgot?
                  </Text>
                </Pressable>
              </View>
              <View style={styles.passwordInputWrap}>
                <TextInput
                  style={[
                    styles.passwordInput,
                    {
                      borderColor:
                        focusedField === "password"
                          ? colors.tint
                          : colors.border,
                      backgroundColor: colors.inputBg,
                      color: colors.text,
                    },
                  ]}
                  placeholder="Enter your password"
                  placeholderTextColor={colors.textTertiary}
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setErrorMessage(null);
                  }}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  textContentType="password"
                  editable={!isPending}
                />
                <Pressable
                  style={styles.eyeButton}
                  onPress={() => setShowPassword((prev) => !prev)}
                >
                  <Ionicons
                    name={showPassword ? "eye-off-outline" : "eye-outline"}
                    size={18}
                    color={colors.textSecondary}
                  />
                </Pressable>
              </View>
            </View>
          </Animated.View>

          {showVerificationMessage ? (
            <View
              style={[
                styles.noticeContainer,
                {
                  backgroundColor: colors.tintLight,
                  borderColor: colors.tintMuted,
                },
              ]}
            >
              <Text
                style={[styles.noticeText, { color: colors.textSecondary }]}
              >
                Verification email sent. Check inbox and spam.
              </Text>
              <Pressable onPress={resendVerificationEmail} disabled={isPending}>
                <Text style={[styles.noticeAction, { color: colors.tint }]}>
                  {isPending ? "Sending..." : "Resend email"}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {errorMessage ? (
            <View
              style={[
                styles.errorContainer,
                {
                  backgroundColor: showVerificationMessage
                    ? colors.tintLight
                    : colors.errorLight,
                  borderColor: showVerificationMessage
                    ? colors.tint
                    : colors.error,
                },
              ]}
            >
              <Text
                style={[
                  styles.errorText,
                  {
                    color: showVerificationMessage
                      ? colors.textSecondary
                      : colors.error,
                  },
                ]}
              >
                {errorMessage}
              </Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              {
                backgroundColor: isDisabled ? colors.tintMuted : colors.tint,
                opacity: pressed ? 0.95 : 1,
              },
            ]}
            onPress={handleSignIn}
            disabled={isDisabled || isPending}
          >
            {isPending ? (
              <ActivityIndicator color={colors.inverseText} />
            ) : (
              <Text style={styles.ctaLabel}>Sign In</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              New here?
            </Text>
            <Link href="/sign-up" asChild>
              <Pressable disabled={isPending}>
                <Text style={[styles.linkText, { color: colors.tint }]}>
                  Create account
                </Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: {
      flex: 1,
    },
    scrollContainer: {
      flexGrow: 1,
      paddingVertical: Spacing["2xl"],
    },
    container: {
      flex: 1,
      paddingHorizontal: Spacing.xl,
      gap: Spacing.lg,
      justifyContent: "center",
      maxWidth: 420,
      alignSelf: "center",
      width: "100%",
      minHeight: "100%",
    },
    loaderContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    header: {
      alignItems: "center",
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    logoWrap: {
      width: 64,
      height: 64,
      borderRadius: Radius.xl,
      alignItems: "center",
      justifyContent: "center",
    },
    logo: {
      width: 42,
      height: 42,
    },
    title: {
      ...Typography.largeTitle,
      textTransform: "capitalize",
    },
    subtitle: {
      ...Typography.callout,
      textAlign: "center",
      maxWidth: 280,
    },
    socialButtonsContainer: {
      gap: Spacing.sm,
    },
    socialButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: Radius.lg,
      paddingVertical: 13,
      paddingHorizontal: Spacing.lg,
      gap: Spacing.sm,
    },
    googleButton: {
      backgroundColor: colors.oauthGoogle,
    },
    appleButton: {
      backgroundColor: colors.oauthApple,
    },
    socialButtonText: {
      color: colors.inverseText,
      ...Typography.bodyMedium,
    },
    divider: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.md,
    },
    dividerLine: {
      flex: 1,
      height: 1,
    },
    dividerText: {
      ...Typography.caption1,
      fontWeight: "600",
      letterSpacing: 0.4,
    },
    card: {
      borderRadius: Radius.xl,
      borderWidth: 1,
      padding: Spacing.lg,
      ...Shadows.sm,
    },
    fieldGroup: {
      gap: Spacing.sm,
      marginBottom: Spacing.md,
    },
    label: {
      ...Typography.caption1,
      fontWeight: "600",
      letterSpacing: 0.2,
      textTransform: "uppercase",
    },
    passwordHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    forgotPasswordText: {
      ...Typography.caption1,
      fontWeight: "600",
    },
    input: {
      borderWidth: 1,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: 12,
      ...Typography.body,
    },
    passwordInputWrap: {
      position: "relative",
      justifyContent: "center",
    },
    passwordInput: {
      borderWidth: 1,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: 12,
      paddingRight: 42,
      ...Typography.body,
    },
    eyeButton: {
      position: "absolute",
      right: 12,
      padding: 2,
    },
    noticeContainer: {
      borderRadius: Radius.md,
      borderWidth: 1,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      gap: 6,
    },
    noticeText: {
      ...Typography.callout,
    },
    noticeAction: {
      ...Typography.caption1,
      fontWeight: "600",
      alignSelf: "flex-start",
    },
    errorContainer: {
      borderRadius: Radius.md,
      borderWidth: 1,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    errorText: {
      ...Typography.callout,
    },
    ctaButton: {
      borderRadius: Radius.full,
      minHeight: 48,
      alignItems: "center",
      justifyContent: "center",
      ...Shadows.sm,
    },
    ctaLabel: {
      color: colors.inverseText,
      ...Typography.bodyMedium,
      letterSpacing: 0.2,
    },
    footer: {
      flexDirection: "row",
      justifyContent: "center",
      alignItems: "center",
      gap: 6,
      marginTop: Spacing.xs,
    },
    footerText: {
      ...Typography.callout,
    },
    linkText: {
      ...Typography.callout,
      fontWeight: "600",
    },
  });
}
