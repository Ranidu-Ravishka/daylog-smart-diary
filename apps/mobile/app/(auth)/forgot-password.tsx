import { useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { useRouter } from "expo-router";
import { useSignIn } from "@clerk/clerk-expo";
import { Ionicons } from "@expo/vector-icons";
import {
  Colors,
  Radius,
  Spacing,
  Typography,
  type ThemeColors,
} from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { withOpacity } from "@/lib/color-utils";
import { captureException } from "@/lib/observability";

type ClerkErrorLike = {
  errors?: {
    code?: string;
    message?: string;
  }[];
};

function getClerkError(err: unknown): ClerkErrorLike {
  if (typeof err === "object" && err !== null && "errors" in err) {
    return err as ClerkErrorLike;
  }
  return {};
}

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { signIn } = useSignIn();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? "light"];
  const styles = useMemo(() => createStyles(colors), [colors]);
  const successBackground = useMemo(
    () => withOpacity(colors.success, colorScheme === "dark" ? 0.18 : 0.12),
    [colors.success, colorScheme],
  );

  const [email, setEmail] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [step, setStep] = useState<"email" | "code" | "newPassword">("email");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSendResetEmail = async () => {
    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    if (!signIn) {
      setError("Authentication service not available");
      return;
    }

    setIsPending(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await signIn.create({
        identifier: email.trim(),
      });

      // Check if password reset is required
      if (result.status === "needs_new_password") {
        setSuccess(`Password reset email sent to ${email}`);
        setStep("code");
      } else {
        // Try to initiate password reset
        const resetResult = await signIn.create({
          strategy: "reset_password_email_code",
          identifier: email.trim(),
        });

        if (resetResult.status === "needs_new_password") {
          setSuccess(`Password reset email sent to ${email}`);
          setStep("code");
        } else {
          setSuccess(
            `Password reset email sent to ${email}. Please check your inbox.`,
          );
          setStep("code");
        }
      }
    } catch (err: unknown) {
      captureException("mobile_forgot_password_send_email_failed", err, {
        emailProvided: email.trim().length > 0,
      });
      const clerkError = getClerkError(err);
      const errorCode = clerkError.errors?.[0]?.code;
      const errorMessage = clerkError.errors?.[0]?.message;

      // Handle specific error cases
      if (errorCode === "form_identifier_not_found") {
        setError("No account found with this email address");
      } else if (errorMessage?.includes("rate limit")) {
        setError("Too many attempts. Please try again in a few minutes.");
      } else {
        setError(
          errorMessage || "Failed to send reset email. Please try again.",
        );
      }
    } finally {
      setIsPending(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!code.trim()) {
      setError("Please enter the verification code");
      return;
    }

    if (!signIn) {
      setError("Authentication service not available");
      return;
    }

    setIsPending(true);
    setError(null);
    setSuccess(null);

    try {
      // Attempt to verify the reset code
      const result = await signIn.attemptFirstFactor({
        strategy: "reset_password_email_code",
        code: code.trim(),
      });

      if (result.status === "needs_new_password") {
        setSuccess("Code verified! Please enter your new password.");
        setStep("newPassword");
      } else {
        setError("Invalid or expired code. Please try again.");
      }
    } catch (err: unknown) {
      captureException("mobile_forgot_password_verify_code_failed", err, {
        emailProvided: email.trim().length > 0,
      });
      const clerkError = getClerkError(err);
      const errorCode = clerkError.errors?.[0]?.code;
      const errorMessage = clerkError.errors?.[0]?.message;

      if (errorCode === "form_code_incorrect") {
        setError("Incorrect verification code");
      } else if (errorCode === "form_param_format_invalid") {
        setError("Invalid code format");
      } else if (errorMessage?.includes("expired")) {
        setError("Verification code has expired. Please request a new one.");
      } else {
        setError(errorMessage || "Failed to verify code. Please try again.");
      }
    } finally {
      setIsPending(false);
    }
  };

  const handleResetPassword = async () => {
    // Validate passwords
    if (!newPassword.trim()) {
      setError("Please enter a new password");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters long");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (!signIn) {
      setError("Authentication service not available");
      return;
    }

    setIsPending(true);
    setError(null);

    try {
      // Reset the password
      const result = await signIn.resetPassword({
        password: newPassword,
        signOutOfOtherSessions: true,
      });

      if (result.status === "complete") {
        setSuccess("Password reset successfully! Redirecting to sign in...");

        // Wait a moment then redirect
        setTimeout(() => {
          router.replace("/(auth)/sign-in");
        }, 2000);
      } else {
        setError("Failed to reset password. Please try again.");
      }
    } catch (err: unknown) {
      captureException("mobile_forgot_password_reset_failed", err, {
        emailProvided: email.trim().length > 0,
      });
      const clerkError = getClerkError(err);
      const errorMessage = clerkError.errors?.[0]?.message;

      if (errorMessage?.includes("weak")) {
        setError("Password is too weak. Please use a stronger password.");
      } else {
        setError(errorMessage || "Failed to reset password. Please try again.");
      }
    } finally {
      setIsPending(false);
    }
  };

  const handleResendCode = async () => {
    if (!email.trim()) {
      setError("Email address is required to resend code");
      return;
    }

    setIsPending(true);
    setError(null);
    setSuccess(null);

    try {
      // Re-initiate the password reset process
      await signIn?.create({
        strategy: "reset_password_email_code",
        identifier: email.trim(),
      });

      setSuccess("New verification code sent to your email");
    } catch (err: unknown) {
      captureException("mobile_forgot_password_resend_code_failed", err, {
        emailProvided: email.trim().length > 0,
      });
      const clerkError = getClerkError(err);
      setError(
        clerkError.errors?.[0]?.message ||
          "Failed to resend code. Please try again.",
      );
    } finally {
      setIsPending(false);
    }
  };

  const goBackToSignIn = () => {
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>
          {/* Logo and Header */}
          <View style={styles.header}>
            <Image
              source={require("@/assets/images/logo.png")}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.title}>Reset Password</Text>
            <Text style={styles.subtitle}>
              {step === "email" && "Enter your email to receive a reset link"}
              {step === "code" &&
                "Enter the verification code sent to your email"}
              {step === "newPassword" && "Create your new password"}
            </Text>
          </View>

          {/* Step Indicator */}
          <View style={styles.stepIndicator}>
            <View style={[styles.step, step === "email" && styles.activeStep]}>
              <Text
                style={[
                  styles.stepText,
                  step === "email" && styles.activeStepText,
                ]}
              >
                1
              </Text>
              <Text
                style={[
                  styles.stepLabel,
                  step === "email" && styles.activeStepLabel,
                ]}
              >
                Email
              </Text>
            </View>
            <View
              style={[
                styles.stepLine,
                step !== "email" && styles.activeStepLine,
              ]}
            />
            <View style={[styles.step, step === "code" && styles.activeStep]}>
              <Text
                style={[
                  styles.stepText,
                  step === "code" && styles.activeStepText,
                ]}
              >
                2
              </Text>
              <Text
                style={[
                  styles.stepLabel,
                  step === "code" && styles.activeStepLabel,
                ]}
              >
                Code
              </Text>
            </View>
            <View
              style={[
                styles.stepLine,
                step === "newPassword" && styles.activeStepLine,
              ]}
            />
            <View
              style={[styles.step, step === "newPassword" && styles.activeStep]}
            >
              <Text
                style={[
                  styles.stepText,
                  step === "newPassword" && styles.activeStepText,
                ]}
              >
                3
              </Text>
              <Text
                style={[
                  styles.stepLabel,
                  step === "newPassword" && styles.activeStepLabel,
                ]}
              >
                Password
              </Text>
            </View>
          </View>

          {/* Step 1: Email Input */}
          {step === "email" && (
            <View style={styles.card}>
              <Text style={styles.label}>Email Address</Text>
              <TextInput
                style={styles.input}
                placeholder="name@example.com"
                value={email}
                onChangeText={(text) => {
                  setEmail(text);
                  setError(null);
                }}
                autoCapitalize="none"
                keyboardType="email-address"
                textContentType="emailAddress"
                autoFocus
                editable={!isPending}
              />

              <TouchableOpacity
                style={[
                  styles.button,
                  (!email.trim() || isPending) && styles.buttonDisabled,
                ]}
                onPress={handleSendResetEmail}
                disabled={!email.trim() || isPending}
              >
                {isPending ? (
                  <ActivityIndicator color={colors.inverseText} />
                ) : (
                  <Text style={styles.buttonText}>Send Reset Link</Text>
                )}
              </TouchableOpacity>

              {/* Cancel/Sign In Link */}
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={goBackToSignIn}
                disabled={isPending}
              >
                <Text style={styles.cancelText}>Back to Sign In</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Step 2: Code Verification */}
          {step === "code" && (
            <View style={styles.card}>
              <Text style={styles.label}>Verification Code</Text>
              <Text style={styles.instruction}>
                Enter the 6-digit code sent to {email}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Enter 6-digit code"
                value={code}
                onChangeText={(text) => {
                  setCode(text.replace(/[^0-9]/g, "").slice(0, 6));
                  setError(null);
                }}
                keyboardType="number-pad"
                maxLength={6}
                autoFocus
                editable={!isPending}
              />

              <View style={styles.codeActions}>
                <TouchableOpacity
                  style={[
                    styles.button,
                    (!code.trim() || code.length !== 6 || isPending) &&
                      styles.buttonDisabled,
                  ]}
                  onPress={handleVerifyCode}
                  disabled={!code.trim() || code.length !== 6 || isPending}
                >
                  {isPending ? (
                    <ActivityIndicator color={colors.inverseText} />
                  ) : (
                    <Text style={styles.buttonText}>Verify Code</Text>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.resendButton}
                  onPress={handleResendCode}
                  disabled={isPending}
                >
                  <Text style={styles.resendText}>
                    {isPending ? "Sending..." : "Resend Code"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Step 3: New Password */}
          {step === "newPassword" && (
            <View style={styles.card}>
              <Text style={styles.label}>New Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter new password"
                value={newPassword}
                onChangeText={(text) => {
                  setNewPassword(text);
                  setError(null);
                }}
                secureTextEntry
                textContentType="newPassword"
                autoFocus
                editable={!isPending}
              />

              <Text style={[styles.label, { marginTop: 16 }]}>
                Confirm Password
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChangeText={(text) => {
                  setConfirmPassword(text);
                  setError(null);
                }}
                secureTextEntry
                textContentType="newPassword"
                editable={!isPending}
              />

              <Text style={styles.passwordHint}>
                • Must be at least 8 characters long
                {"\n"}• Include uppercase and lowercase letters
                {"\n"}• Include numbers or special characters
              </Text>

              <TouchableOpacity
                style={[
                  styles.button,
                  (!newPassword.trim() ||
                    newPassword.length < 8 ||
                    newPassword !== confirmPassword ||
                    isPending) &&
                    styles.buttonDisabled,
                ]}
                onPress={handleResetPassword}
                disabled={
                  !newPassword.trim() ||
                  newPassword.length < 8 ||
                  newPassword !== confirmPassword ||
                  isPending
                }
              >
                {isPending ? (
                  <ActivityIndicator color={colors.inverseText} />
                ) : (
                  <Text style={styles.buttonText}>Reset Password</Text>
                )}
              </TouchableOpacity>
            </View>
          )}

          {/* Success Message */}
          {success && (
            <View
              style={[
                styles.successContainer,
                { backgroundColor: successBackground },
              ]}
            >
              <Ionicons
                name="checkmark-circle"
                size={20}
                color={colors.success}
              />
              <Text style={styles.successText}>{success}</Text>
            </View>
          )}

          {/* Error Message */}
          {error && (
            <View style={styles.errorContainer}>
              <Ionicons name="alert-circle" size={20} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Help Text */}
          <View style={styles.helpContainer}>
            <Text style={styles.helpText}>
              <Ionicons
                name="information-circle"
                size={16}
                color={colors.textSecondary}
              />{" "}
              {step === "email" &&
                "Check your spam folder if you don't see the email"}
              {step === "code" && "The code expires in 30 minutes"}
              {step === "newPassword" &&
                "Make sure to remember your new password"}
            </Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContainer: {
      flexGrow: 1,
    },
    content: {
      flex: 1,
      padding: Spacing["2xl"],
      maxWidth: 400,
      alignSelf: "center",
      width: "100%",
    },
    header: {
      alignItems: "center",
      marginBottom: Spacing["3xl"],
      marginTop: Spacing.xl,
    },
    logo: {
      width: 60,
      height: 60,
      marginBottom: Spacing.lg,
      borderRadius: Radius.sm + 2,
    },
    title: {
      ...Typography.largeTitle,
      color: colors.text,
      marginBottom: Spacing.sm,
      textAlign: "center",
    },
    subtitle: {
      ...Typography.body,
      color: colors.textSecondary,
      textAlign: "center",
    },
    stepIndicator: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: Spacing["3xl"],
      paddingHorizontal: Spacing.xl,
    },
    step: {
      alignItems: "center",
      width: 60,
    },
    activeStep: {
      transform: [{ scale: 1.1 }],
    },
    stepText: {
      width: 32,
      height: 32,
      borderRadius: Radius.full,
      backgroundColor: colors.surfaceSecondary,
      textAlign: "center",
      lineHeight: 32,
      ...Typography.button,
      color: colors.textTertiary,
      marginBottom: 4,
    },
    activeStepText: {
      backgroundColor: colors.tint,
      color: colors.inverseText,
    },
    stepLabel: {
      ...Typography.label,
      color: colors.textTertiary,
    },
    activeStepLabel: {
      color: colors.tint,
    },
    stepLine: {
      flex: 1,
      height: 2,
      backgroundColor: colors.surfaceSecondary,
      marginHorizontal: Spacing.sm,
      maxWidth: 40,
    },
    activeStepLine: {
      backgroundColor: colors.tint,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: Radius.xl,
      padding: Spacing["2xl"],
      shadowColor: colors.cardShadow,
      shadowOffset: {
        width: 0,
        height: 2,
      },
      shadowOpacity: 0.05,
      shadowRadius: 10,
      elevation: 3,
      marginBottom: Spacing.xl,
    },
    label: {
      ...Typography.bodyMedium,
      color: colors.textSecondary,
      marginBottom: Spacing.sm,
    },
    instruction: {
      ...Typography.callout,
      color: colors.textSecondary,
      marginBottom: Spacing.lg,
    },
    input: {
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: 14,
      ...Typography.body,
      backgroundColor: colors.inputBg,
      color: colors.text,
      marginBottom: Spacing.xl,
    },
    button: {
      backgroundColor: colors.tint,
      borderRadius: Radius.md,
      paddingVertical: Spacing.lg,
      alignItems: "center",
      shadowColor: colors.tint,
      shadowOffset: {
        width: 0,
        height: 4,
      },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 4,
      marginBottom: Spacing.md,
    },
    buttonDisabled: {
      backgroundColor: colors.tintMuted,
      shadowOpacity: 0,
    },
    buttonText: {
      ...Typography.button,
      color: colors.inverseText,
    },
    cancelButton: {
      alignItems: "center",
      paddingVertical: Spacing.md,
    },
    cancelText: {
      ...Typography.button,
      color: colors.textSecondary,
    },
    codeActions: {
      gap: Spacing.md,
    },
    resendButton: {
      alignItems: "center",
      paddingVertical: Spacing.md,
    },
    resendText: {
      ...Typography.button,
      color: colors.tint,
    },
    passwordHint: {
      ...Typography.caption1,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: Spacing.xl,
    },
    successContainer: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: Radius.md,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
      borderLeftWidth: 4,
      borderLeftColor: colors.success,
      gap: Spacing.sm,
    },
    successText: {
      ...Typography.callout,
      color: colors.success,
      flex: 1,
    },
    errorContainer: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: colors.errorLight,
      borderRadius: Radius.md,
      padding: Spacing.lg,
      marginBottom: Spacing.lg,
      borderLeftWidth: 4,
      borderLeftColor: colors.error,
      gap: Spacing.sm,
    },
    errorText: {
      ...Typography.callout,
      color: colors.error,
      flex: 1,
    },
    helpContainer: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: Radius.md,
      padding: Spacing.lg,
      marginTop: Spacing.sm,
    },
    helpText: {
      ...Typography.callout,
      color: colors.textSecondary,
    },
  });
}
