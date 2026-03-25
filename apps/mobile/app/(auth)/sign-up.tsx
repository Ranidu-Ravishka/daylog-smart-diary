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
import { useAuth, useOAuth, useSignUp } from "@clerk/clerk-expo";
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

type ClerkErrorLike = {
  errors?: {
    message?: string;
    code?: string;
  }[];
};

type FocusedField =
  | "firstName"
  | "lastName"
  | "email"
  | "password"
  | "code"
  | null;

function getClerkError(error: unknown): ClerkErrorLike {
  if (typeof error === "object" && error !== null && "errors" in error) {
    return error as ClerkErrorLike;
  }
  return {};
}

export default function SignUpScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const styles = useMemo(() => createStyles(colors), [colors]);

  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signUp, setActive } = useSignUp();

  const { startOAuthFlow: startGoogleOAuth } = useOAuth({
    strategy: "oauth_google",
  });
  const { startOAuthFlow: startAppleOAuth } = useOAuth({
    strategy: "oauth_apple",
  });

  const [emailAddress, setEmailAddress] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [focusedField, setFocusedField] = useState<FocusedField>(null);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace("/quick-setup");
    }
  }, [authLoaded, isSignedIn, router]);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const isPrimaryActionDisabled = useMemo(() => {
    if (pendingVerification) {
      return verificationCode.trim().length !== 6 || !isLoaded || isPending;
    }

    return (
      !emailAddress.trim() || password.length < 8 || !isLoaded || isPending
    );
  }, [
    pendingVerification,
    verificationCode,
    emailAddress,
    password,
    isLoaded,
    isPending,
  ]);

  const handleOAuthSignIn = async (
    strategy: "oauth_google" | "oauth_apple",
  ) => {
    const startOAuthFlow =
      strategy === "oauth_google" ? startGoogleOAuth : startAppleOAuth;

    if (!isLoaded) return;

    setIsPending(true);
    setErrorMessage(null);

    try {
      const oauthResult = await startOAuthFlow();

      if (oauthResult?.createdSessionId) {
        if (setActive) {
          await setActive({ session: oauthResult.createdSessionId });
        }
        router.replace("/quick-setup");
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

  const handleSignUp = async () => {
    if (!isLoaded) return;

    setIsPending(true);
    setErrorMessage(null);

    try {
      const firstNameTrimmed = firstName.trim();
      const lastNameTrimmed = lastName.trim();

      await signUp.create({
        emailAddress: emailAddress.trim(),
        password,
        firstName: firstNameTrimmed || undefined,
        lastName: lastNameTrimmed || undefined,
      });

      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });

      setPendingVerification(true);
      setErrorMessage(null);
      setResendCooldown(60);
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
            clerkError.errors?.[0]?.message ?? "Unable to sign up.";
          const errorCode = clerkError.errors?.[0]?.code;

          if (errorCode === "form_identifier_exists") {
            setErrorMessage(
              "An account with this email already exists. Please sign in.",
            );
          } else if (errorCode === "form_password_pwned") {
            setErrorMessage(
              "This password has been compromised. Please choose a different one.",
            );
          } else if (
            errorMsg.includes("password") &&
            errorMsg.includes("weak")
          ) {
            setErrorMessage(
              "Password is too weak. Please use a stronger password.",
            );
          } else if (
            errorMsg.includes("email") &&
            errorMsg.includes("invalid")
          ) {
            setErrorMessage("Please enter a valid email address.");
          } else {
            setErrorMessage(errorMsg);
          }
        } else if ("message" in error) {
          setErrorMessage((error as { message: string }).message);
        }
      } else {
        setErrorMessage("Unable to sign up. Please try again.");
      }
    } finally {
      setIsPending(false);
    }
  };

  const handleVerification = async () => {
    if (!isLoaded) return;

    setIsPending(true);
    setErrorMessage(null);

    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: verificationCode.trim(),
      });

      if (result.status === "complete") {
        if (setActive) {
          await setActive({ session: result.createdSessionId });
        }
        router.replace("/quick-setup");
      } else if (result.status === "missing_requirements") {
        setErrorMessage(
          "Additional information is required to complete sign-up.",
        );
      } else {
        setErrorMessage("Unable to complete verification. Please try again.");
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
            clerkError.errors?.[0]?.message ?? "Invalid verification code.";
          const errorCode = clerkError.errors?.[0]?.code;

          if (errorCode === "form_code_incorrect") {
            setErrorMessage("Incorrect verification code. Please try again.");
          } else if (errorCode === "form_param_format_invalid") {
            setErrorMessage(
              "Invalid code format. Please enter a 6-digit code.",
            );
          } else if (errorMsg.includes("expired")) {
            setErrorMessage(
              "Verification code has expired. Please request a new one.",
            );
          } else {
            setErrorMessage(errorMsg);
          }
        }
      } else {
        setErrorMessage("Invalid verification code.");
      }
    } finally {
      setIsPending(false);
    }
  };

  const handleResendCode = async () => {
    if (!isLoaded || resendCooldown > 0) return;

    setIsPending(true);
    setErrorMessage(null);

    try {
      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });

      setResendCooldown(60);
      setErrorMessage(
        "✅ New verification code sent! Please check your email.",
      );
    } catch (error: unknown) {
      const clerkError = getClerkError(error);
      setErrorMessage(
        clerkError.errors?.[0]?.message ||
          "Failed to resend code. Please try again.",
      );
    } finally {
      setIsPending(false);
    }
  };

  const goBackToSignUp = () => {
    setPendingVerification(false);
    setVerificationCode("");
    setErrorMessage(null);
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
              {pendingVerification
                ? "Verify your email"
                : "Create your account"}
            </Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
              {pendingVerification
                ? `Enter the 6-digit code sent to ${emailAddress}`
                : "Start capturing meaningful moments in seconds."}
            </Text>
          </Animated.View>

          {!pendingVerification ? (
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
                <Ionicons name="logo-google" size={18} color="#FFFFFF" />
                <Text style={styles.socialButtonText}>
                  Continue with Google
                </Text>
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
                  <Ionicons name="logo-apple" size={18} color="#FFFFFF" />
                  <Text style={styles.socialButtonText}>
                    Continue with Apple
                  </Text>
                </Pressable>
              ) : null}
            </Animated.View>
          ) : null}

          {!pendingVerification ? (
            <View style={styles.divider}>
              <View
                style={[styles.dividerLine, { backgroundColor: colors.border }]}
              />
              <Text
                style={[styles.dividerText, { color: colors.textTertiary }]}
              >
                OR
              </Text>
              <View
                style={[styles.dividerLine, { backgroundColor: colors.border }]}
              />
            </View>
          ) : null}

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
            {pendingVerification ? (
              <>
                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Verification code
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      styles.codeInput,
                      {
                        borderColor:
                          focusedField === "code" ? colors.tint : colors.border,
                        backgroundColor: colors.inputBg,
                        color: colors.text,
                      },
                    ]}
                    placeholder="Enter 6-digit code"
                    placeholderTextColor={colors.textTertiary}
                    keyboardType="number-pad"
                    value={verificationCode}
                    onChangeText={(text) => {
                      setVerificationCode(
                        text.replace(/[^0-9]/g, "").slice(0, 6),
                      );
                      setErrorMessage(null);
                    }}
                    onFocus={() => setFocusedField("code")}
                    onBlur={() => setFocusedField(null)}
                    textContentType="oneTimeCode"
                    maxLength={6}
                    autoFocus
                    editable={!isPending}
                  />
                </View>

                <View style={styles.rowActions}>
                  <Pressable
                    onPress={handleResendCode}
                    disabled={isPending || resendCooldown > 0}
                  >
                    <Text
                      style={[
                        styles.rowActionText,
                        {
                          color:
                            isPending || resendCooldown > 0
                              ? colors.textTertiary
                              : colors.tint,
                        },
                      ]}
                    >
                      {resendCooldown > 0
                        ? `Resend in ${resendCooldown}s`
                        : "Resend code"}
                    </Text>
                  </Pressable>

                  <Pressable onPress={goBackToSignUp} disabled={isPending}>
                    <Text
                      style={[
                        styles.rowActionSecondaryText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Back
                    </Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <View style={styles.nameRow}>
                  <View style={styles.halfField}>
                    <Text
                      style={[styles.label, { color: colors.textSecondary }]}
                    >
                      First name
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          borderColor:
                            focusedField === "firstName"
                              ? colors.tint
                              : colors.border,
                          backgroundColor: colors.inputBg,
                          color: colors.text,
                        },
                      ]}
                      autoCapitalize="words"
                      autoCorrect={false}
                      placeholder="John"
                      placeholderTextColor={colors.textTertiary}
                      value={firstName}
                      onChangeText={(text) => {
                        setFirstName(text);
                        setErrorMessage(null);
                      }}
                      onFocus={() => setFocusedField("firstName")}
                      onBlur={() => setFocusedField(null)}
                      textContentType="givenName"
                      editable={!isPending}
                    />
                  </View>

                  <View style={styles.halfField}>
                    <Text
                      style={[styles.label, { color: colors.textSecondary }]}
                    >
                      Last name
                    </Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          borderColor:
                            focusedField === "lastName"
                              ? colors.tint
                              : colors.border,
                          backgroundColor: colors.inputBg,
                          color: colors.text,
                        },
                      ]}
                      autoCapitalize="words"
                      autoCorrect={false}
                      placeholder="Doe"
                      placeholderTextColor={colors.textTertiary}
                      value={lastName}
                      onChangeText={(text) => {
                        setLastName(text);
                        setErrorMessage(null);
                      }}
                      onFocus={() => setFocusedField("lastName")}
                      onBlur={() => setFocusedField(null)}
                      textContentType="familyName"
                      editable={!isPending}
                    />
                  </View>
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Email address
                  </Text>
                  <TextInput
                    style={[
                      styles.input,
                      {
                        borderColor:
                          focusedField === "email"
                            ? colors.tint
                            : colors.border,
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
                    }}
                    onFocus={() => setFocusedField("email")}
                    onBlur={() => setFocusedField(null)}
                    textContentType="emailAddress"
                    autoFocus
                    editable={!isPending}
                  />
                </View>

                <View style={styles.fieldGroup}>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    Password
                  </Text>
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
                      placeholder="Minimum 8 characters"
                      placeholderTextColor={colors.textTertiary}
                      secureTextEntry={!showPassword}
                      value={password}
                      onChangeText={(text) => {
                        setPassword(text);
                        setErrorMessage(null);
                      }}
                      onFocus={() => setFocusedField("password")}
                      onBlur={() => setFocusedField(null)}
                      textContentType="newPassword"
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
                  <Text
                    style={[
                      styles.passwordHint,
                      { color: colors.textTertiary },
                    ]}
                  >
                    Use at least 8 characters and mix letters with numbers or
                    symbols.
                  </Text>
                </View>
              </>
            )}
          </Animated.View>

          {errorMessage ? (
            <View
              style={[
                styles.errorContainer,
                {
                  backgroundColor: errorMessage.includes("✅")
                    ? colors.tintLight
                    : colors.errorLight,
                  borderColor: errorMessage.includes("✅")
                    ? colors.tint
                    : colors.error,
                },
              ]}
            >
              <Text
                style={[
                  styles.errorText,
                  {
                    color: errorMessage.includes("✅")
                      ? colors.textSecondary
                      : colors.error,
                  },
                ]}
              >
                {errorMessage.replace("✅ ", "")}
              </Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              {
                backgroundColor: isPrimaryActionDisabled
                  ? colors.tintMuted
                  : colors.tint,
                opacity: pressed ? 0.95 : 1,
              },
            ]}
            onPress={pendingVerification ? handleVerification : handleSignUp}
            disabled={isPrimaryActionDisabled || isPending}
          >
            {isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.ctaLabel}>
                {pendingVerification ? "Verify Email" : "Create Account"}
              </Text>
            )}
          </Pressable>

          {!pendingVerification ? (
            <View style={styles.footer}>
              <Text
                style={[styles.footerText, { color: colors.textSecondary }]}
              >
                Already have an account?
              </Text>
              <Link href="/sign-in" asChild>
                <Pressable disabled={isPending}>
                  <Text style={[styles.linkText, { color: colors.tint }]}>
                    Sign in
                  </Text>
                </Pressable>
              </Link>
            </View>
          ) : (
            <View
              style={[
                styles.infoFooter,
                {
                  backgroundColor: colors.surfaceSecondary,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[styles.infoFooterText, { color: colors.textSecondary }]}
              >
                Didn’t receive the code? Check spam or request a new one.
              </Text>
            </View>
          )}
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
      maxWidth: 440,
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
      textAlign: "center",
    },
    subtitle: {
      ...Typography.callout,
      textAlign: "center",
      maxWidth: 320,
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
      backgroundColor: "#4285F4",
    },
    appleButton: {
      backgroundColor: "#111111",
    },
    socialButtonText: {
      color: "#FFFFFF",
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
      gap: Spacing.md,
      ...Shadows.sm,
    },
    nameRow: {
      flexDirection: "row",
      gap: Spacing.md,
    },
    halfField: {
      flex: 1,
      gap: Spacing.sm,
    },
    fieldGroup: {
      gap: Spacing.sm,
    },
    label: {
      ...Typography.caption1,
      fontWeight: "600",
      letterSpacing: 0.2,
      textTransform: "uppercase",
    },
    input: {
      borderWidth: 1,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: 12,
      ...Typography.body,
    },
    codeInput: {
      letterSpacing: 3,
      textAlign: "center",
      fontWeight: "600",
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
    passwordHint: {
      ...Typography.caption2,
      lineHeight: 16,
    },
    rowActions: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: Spacing.xs,
    },
    rowActionText: {
      ...Typography.caption1,
      fontWeight: "600",
    },
    rowActionSecondaryText: {
      ...Typography.caption1,
      fontWeight: "600",
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
      color: "#FFFFFF",
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
    infoFooter: {
      borderRadius: Radius.md,
      borderWidth: 1,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    infoFooterText: {
      ...Typography.caption1,
      textAlign: "center",
    },
  });
}
