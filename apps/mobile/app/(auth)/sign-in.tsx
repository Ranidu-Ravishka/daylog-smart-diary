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
import { useAuth, useSignIn, useOAuth, useSignUp } from "@clerk/clerk-expo";
import * as WebBrowser from "expo-web-browser";
import { Ionicons } from "@expo/vector-icons";

WebBrowser.maybeCompleteAuthSession();

export default function SignInScreen() {
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signIn, setActive } = useSignIn();
  const { signUp } = useSignUp(); // Added for verification flow

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

  const handleSignIn = async () => {
    if (!isLoaded) {
      return;
    }

    setIsPending(true);
    setErrorMessage(null);
    setShowVerificationMessage(false);

    try {
      const result = await signIn.create({
        identifier: emailAddress.trim(),
        password,
      });

      console.log("Sign-in result status:", result.status);

      if (result.status === "complete") {
        if (setActive) {
          await setActive({ session: result.createdSessionId });
        }
        router.replace("/quick-setup");
      } else if (result.status === "needs_first_factor") {
        // Check if email verification is needed
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
      console.error("Sign-in error:", error);

      // Handle Clerk errors
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
            clerkError.errors?.[0]?.message ?? "Unable to sign in.";
          const errorCode = clerkError.errors?.[0]?.code;

          // Handle specific error cases
          if (errorCode === "form_identifier_not_found") {
            setErrorMessage("No account found with this email.");
          } else if (errorCode === "form_password_incorrect") {
            setErrorMessage("Incorrect password.");
          } else if (
            errorMsg.includes("email") ||
            errorMsg.includes("verify")
          ) {
            // Check if we should trigger email verification
            triggerEmailVerification();
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

  // Function to trigger email verification
  const triggerEmailVerification = async () => {
    try {
      // Try to create a sign-up attempt to trigger verification
      if (signUp) {
        await signUp.create({
          emailAddress: emailAddress.trim(),
        });

        // Attempt to prepare verification
        await signUp.prepareEmailAddressVerification({
          strategy: "email_code",
        });

        setShowVerificationMessage(true);
        setErrorMessage("Verification email sent! Please check your inbox.");
      }
    } catch (verificationError) {
      console.log("Verification trigger error:", verificationError);
      setErrorMessage(
        "Unable to send verification email. Please contact support.",
      );
    }
  };

  // Function to resend verification email
  const resendVerificationEmail = async () => {
    if (!signUp) return;

    setIsPending(true);
    try {
      await signUp.prepareEmailAddressVerification({
        strategy: "email_code",
      });
      setErrorMessage("Verification email resent! Please check your inbox.");
    } catch (error) {
      console.error("Resend error:", error);
      setErrorMessage("Unable to resend verification email.");
    } finally {
      setIsPending(false);
    }
  };

  // Function to handle forgot password
  const handleForgotPassword = () => {
    router.push("/forgot-password");
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
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>
              Sign in to continue your journey
            </Text>
          </View>

          <View style={styles.socialButtonsContainer}>
            <TouchableOpacity
              style={[styles.socialButton, styles.googleButton]}
              onPress={() => handleOAuthSignIn("oauth_google")}
              disabled={isPending}
            >
              <Ionicons name="logo-google" size={20} color="#ffffff" />
              <Text style={styles.socialButtonText}>Continue with Google</Text>
            </TouchableOpacity>

            {Platform.OS === "ios" && (
              <TouchableOpacity
                style={[styles.socialButton, styles.appleButton]}
                onPress={() => handleOAuthSignIn("oauth_apple")}
                disabled={isPending}
              >
                <Ionicons name="logo-apple" size={20} color="#ffffff" />
                <Text style={styles.socialButtonText}>Continue with Apple</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.divider}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.dividerLine} />
          </View>

          <View style={styles.card}>
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
                  setShowVerificationMessage(false);
                }}
                textContentType="emailAddress"
                autoFocus
                editable={!isPending}
              />
            </View>

            <View style={styles.fieldGroup}>
              <View style={styles.passwordHeader}>
                <Text style={styles.label}>Password</Text>
                <TouchableOpacity onPress={handleForgotPassword}>
                  <Text style={styles.forgotPasswordText}>
                    Forgot Password?
                  </Text>
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                secureTextEntry
                value={password}
                onChangeText={(text) => {
                  setPassword(text);
                  setErrorMessage(null);
                }}
                textContentType="password"
                editable={!isPending}
              />
            </View>
          </View>

          {showVerificationMessage && (
            <View style={styles.verificationContainer}>
              <Text style={styles.verificationText}>
                📧 Verification email sent! Please check your inbox and spam
                folder.
              </Text>
              <TouchableOpacity
                onPress={resendVerificationEmail}
                disabled={isPending}
                style={styles.resendButton}
              >
                <Text style={styles.resendText}>
                  {isPending ? "Sending..." : "Resend verification email"}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {errorMessage ? (
            <View
              style={[
                styles.errorContainer,
                showVerificationMessage && styles.successContainer,
              ]}
            >
              <Text
                style={[
                  styles.errorText,
                  showVerificationMessage && styles.successText,
                ]}
              >
                {showVerificationMessage ? "✅ " : "⚠️ "}
                {errorMessage}
              </Text>
            </View>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.ctaButton,
              isDisabled && styles.ctaButtonDisabled,
              pressed && styles.ctaButtonPressed,
            ]}
            onPress={handleSignIn}
            disabled={isDisabled || isPending}
          >
            {isPending ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.ctaLabel}>Sign In</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>New here?</Text>
            <Link href="/sign-up" asChild>
              <Pressable style={styles.linkButton} disabled={isPending}>
                <Text style={styles.linkText}>Create Account</Text>
              </Pressable>
            </Link>
          </View>
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
    marginBottom: 16,
  },
  passwordHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  forgotPasswordText: {
    color: "#6366f1",
    fontSize: 14,
    fontWeight: "500",
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
  verificationContainer: {
    backgroundColor: "#f0f9ff",
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#0ea5e9",
    gap: 8,
  },
  verificationText: {
    color: "#0369a1",
    fontSize: 14,
    lineHeight: 20,
  },
  resendButton: {
    alignSelf: "flex-start",
  },
  resendText: {
    color: "#0ea5e9",
    fontSize: 14,
    fontWeight: "600",
  },
  errorContainer: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    padding: 12,
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
  forgotPasswordContainer: {
    alignItems: "center",
    marginTop: 8,
    marginBottom: 8,
  },
});
