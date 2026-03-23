import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  TouchableOpacity,
  Image,
  ScrollView,
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth, useSignUp, useOAuth } from "@clerk/clerk-expo";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";

WebBrowser.maybeCompleteAuthSession();

type ClerkErrorLike = {
  errors?: {
    message?: string;
    code?: string;
  }[];
};

function getClerkError(error: unknown): ClerkErrorLike {
  if (typeof error === "object" && error !== null && "errors" in error) {
    return error as ClerkErrorLike;
  }
  return {};
}

export default function SignUpScreen() {
  const router = useRouter();
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

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace("/quick-setup");
    }
  }, [authLoaded, isSignedIn, router]);

  // Resend cooldown timer
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
      console.error("OAuth error:", err);
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
    if (!isLoaded) {
      return;
    }

    setIsPending(true);
    setErrorMessage(null);

    try {
      // Create the sign-up attempt
      const firstNameTrimmed = firstName.trim();
      const lastNameTrimmed = lastName.trim();

      await signUp.create({
        emailAddress: emailAddress.trim(),
        password,
        firstName: firstNameTrimmed || undefined,
        lastName: lastNameTrimmed || undefined,
      });

      // Prepare email verification
      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });

      // Switch to verification view
      setPendingVerification(true);
      setErrorMessage(null);
      setResendCooldown(60); // 60-second cooldown for resend
    } catch (error: unknown) {
      console.error("Sign-up error:", error);

      if (typeof error === "object" && error !== null) {
        if ("errors" in error) {
          const clerkError = error as {
            errors?: {
              message?: string;
              code?: string;
              longMessage?: string;
            }[];
          };

          const errorMsg =
            clerkError.errors?.[0]?.message ?? "Unable to sign up.";
          const errorCode = clerkError.errors?.[0]?.code;

          // Handle specific error cases
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
    if (!isLoaded) {
      return;
    }

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
      console.error("Verification error:", error);

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

      setResendCooldown(60); // Reset cooldown to 60 seconds
      setErrorMessage(
        "✅ New verification code sent! Please check your email.",
      );
    } catch (error: unknown) {
      console.error("Resend error:", error);
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
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Image
              source={require("@/assets/images/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>
              {pendingVerification ? "Verify Your Email" : "Join our community"}
            </Text>
            <Text style={styles.subtitle}>
              {pendingVerification
                ? `Enter the 6-digit code sent to ${emailAddress}`
                : "Create your account to get started"}
            </Text>
          </View>

          {!pendingVerification && (
            <>
              <View style={styles.socialButtonsContainer}>
                <TouchableOpacity
                  style={[styles.socialButton, styles.googleButton]}
                  onPress={() => handleOAuthSignIn("oauth_google")}
                  disabled={isPending}
                >
                  <Ionicons name="logo-google" size={20} color="#ffffff" />
                  <Text style={styles.socialButtonText}>
                    Continue with Google
                  </Text>
                </TouchableOpacity>

                {Platform.OS === "ios" && (
                  <TouchableOpacity
                    style={[styles.socialButton, styles.appleButton]}
                    onPress={() => handleOAuthSignIn("oauth_apple")}
                    disabled={isPending}
                  >
                    <Ionicons name="logo-apple" size={20} color="#ffffff" />
                    <Text style={styles.socialButtonText}>
                      Continue with Apple
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.divider}>
                <View style={styles.dividerLine} />
                <Text style={styles.dividerText}>OR</Text>
                <View style={styles.dividerLine} />
              </View>
            </>
          )}

          {pendingVerification ? (
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Verification Code</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter 6-digit code"
                  keyboardType="number-pad"
                  value={verificationCode}
                  onChangeText={(text) => {
                    setVerificationCode(
                      text.replace(/[^0-9]/g, "").slice(0, 6),
                    );
                    setErrorMessage(null);
                  }}
                  textContentType="oneTimeCode"
                  maxLength={6}
                  autoFocus
                  editable={!isPending}
                />

                <View style={styles.resendContainer}>
                  <TouchableOpacity
                    onPress={handleResendCode}
                    disabled={isPending || resendCooldown > 0}
                    style={styles.resendButton}
                  >
                    <Text
                      style={[
                        styles.resendText,
                        (isPending || resendCooldown > 0) &&
                          styles.resendTextDisabled,
                      ]}
                    >
                      {resendCooldown > 0
                        ? `Resend in ${resendCooldown}s`
                        : "Resend code"}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={goBackToSignUp}
                    disabled={isPending}
                    style={styles.backButton}
                  >
                    <Text style={styles.backText}>Back to sign up</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.fieldGroup}>
                <Text style={styles.label}>First Name</Text>
                <TextInput
                  style={styles.input}
                  autoCapitalize="words"
                  autoCorrect={false}
                  placeholder="John"
                  value={firstName}
                  onChangeText={(text) => {
                    setFirstName(text);
                    setErrorMessage(null);
                  }}
                  textContentType="givenName"
                  editable={!isPending}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Last Name</Text>
                <TextInput
                  style={styles.input}
                  autoCapitalize="words"
                  autoCorrect={false}
                  placeholder="Doe"
                  value={lastName}
                  onChangeText={(text) => {
                    setLastName(text);
                    setErrorMessage(null);
                  }}
                  textContentType="familyName"
                  editable={!isPending}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Email Address</Text>
                <TextInput
                  style={styles.input}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  placeholder="name@example.com"
                  value={emailAddress}
                  onChangeText={(text) => {
                    setEmailAddress(text);
                    setErrorMessage(null);
                  }}
                  textContentType="emailAddress"
                  autoFocus
                  editable={!isPending}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Password</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Minimum 8 characters"
                  secureTextEntry
                  value={password}
                  onChangeText={(text) => {
                    setPassword(text);
                    setErrorMessage(null);
                  }}
                  textContentType="newPassword"
                  editable={!isPending}
                />
                <Text style={styles.passwordHint}>
                  • At least 8 characters
                  {"\n"}• Include uppercase and lowercase letters
                  {"\n"}• Include numbers or special characters
                </Text>
              </View>
            </View>
          )}

          {errorMessage && (
            <View
              style={[
                styles.errorContainer,
                errorMessage.includes("✅") && styles.successContainer,
              ]}
            >
              <Text
                style={[
                  styles.errorText,
                  errorMessage.includes("✅") && styles.successText,
                ]}
              >
                {errorMessage.includes("✅") ? "✅ " : "⚠️ "}
                {errorMessage.replace("✅ ", "")}
              </Text>
            </View>
          )}

          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              isPrimaryActionDisabled && styles.ctaButtonDisabled,
              pressed && styles.ctaButtonPressed,
            ]}
            onPress={pendingVerification ? handleVerification : handleSignUp}
            disabled={isPrimaryActionDisabled || isPending}
          >
            {isPending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.ctaLabel}>
                {pendingVerification ? "Verify Email" : "Create Account"}
              </Text>
            )}
          </Pressable>

          {!pendingVerification ? (
            <View style={styles.footer}>
              <Text style={styles.footerText}>Already have an account?</Text>
              <Link href="/sign-in" asChild>
                <Pressable style={styles.linkButton} disabled={isPending}>
                  <Text style={styles.linkText}>Sign In</Text>
                </Pressable>
              </Link>
            </View>
          ) : (
            <View style={styles.verificationFooter}>
              <Text style={styles.verificationFooterText}>
                <Ionicons
                  name="information-circle-outline"
                  size={16}
                  color="#64748b"
                />{" "}
                Check your spam folder if you don{"'"}t see the email
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: "#f8fafc",
  },
  scrollContainer: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    padding: 24,
    gap: 24,
    justifyContent: "center",
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
    minHeight: "100%",
  },
  loaderContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  header: {
    alignItems: "center",
    gap: 12,
    marginBottom: 8,
  },
  logo: {
    width: 60,
    height: 60,
    marginBottom: 5,
    borderRadius: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#0f172a",
    letterSpacing: -0.5,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 15,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 22,
  },
  socialButtonsContainer: {
    gap: 12,
  },
  socialButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  googleButton: {
    backgroundColor: "#4285F4",
  },
  appleButton: {
    backgroundColor: "#000000",
  },
  socialButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "500",
  },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: "#e2e8f0",
  },
  dividerText: {
    fontSize: 14,
    color: "#94a3b8",
    fontWeight: "500",
  },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 20,
    padding: 24,
    shadowColor: "#0f172a",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  fieldGroup: {
    gap: 12,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#334155",
    letterSpacing: 0.2,
  },
  input: {
    borderWidth: 1.5,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    backgroundColor: "#ffffff",
    color: "#0f172a",
  },
  passwordHint: {
    fontSize: 12,
    color: "#64748b",
    lineHeight: 18,
    marginTop: 4,
  },
  resendContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 8,
  },
  resendButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  resendText: {
    color: "#6366f1",
    fontSize: 14,
    fontWeight: "600",
  },
  resendTextDisabled: {
    color: "#94a3b8",
  },
  backButton: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backText: {
    color: "#64748b",
    fontSize: 14,
    fontWeight: "500",
  },
  errorContainer: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#dc2626",
  },
  successContainer: {
    backgroundColor: "#f0fdf4",
    borderLeftColor: "#22c55e",
  },
  errorText: {
    color: "#dc2626",
    fontSize: 14,
    lineHeight: 20,
  },
  successText: {
    color: "#15803d",
  },
  ctaButton: {
    borderRadius: 14,
    backgroundColor: "#6366f1",
    paddingVertical: 16,
    alignItems: "center",
    shadowColor: "#6366f1",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  ctaButtonDisabled: {
    backgroundColor: "#c7d2fe",
    shadowOpacity: 0,
  },
  ctaButtonPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: "#4f46e5",
  },
  ctaLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 8,
  },
  footerText: {
    fontSize: 15,
    color: "#64748b",
  },
  linkButton: {
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  linkText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#6366f1",
  },
  verificationFooter: {
    backgroundColor: "#f1f5f9",
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  verificationFooterText: {
    color: "#64748b",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
});
