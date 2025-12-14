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
} from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth, useSignUp } from "@clerk/clerk-expo";

export default function SignUpScreen() {
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signUp, setActive } = useSignUp();

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace("/");
    }
  }, [authLoaded, isSignedIn, router]);

  const isPrimaryActionDisabled = useMemo(() => {
    if (pendingVerification) {
      return verificationCode.trim().length === 0 || !isLoaded || isPending;
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

  const handleSignUp = async () => {
    if (!isLoaded) {
      return;
    }

    setIsPending(true);
    setErrorMessage(null);

    try {
      const result = await signUp.create({
        emailAddress: emailAddress.trim(),
        password,
      });

      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });

      if (result.status && result.status === "complete") {
        // No verification code needed in these cases, but we treat them as a success path.
        await setActive({ session: result.createdSessionId });
        router.replace("/");
        return;
      }

      setPendingVerification(true);
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "errors" in error) {
        const clerkError = error as { errors?: Array<{ message?: string }> };
        setErrorMessage(
          clerkError.errors?.[0]?.message ?? "Unable to sign up.",
        );
      } else {
        setErrorMessage("Unable to sign up.");
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
        await setActive({ session: result.createdSessionId });
        router.replace("/");
      } else {
        setErrorMessage("Verification requires additional steps in Clerk.");
      }
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "errors" in error) {
        const clerkError = error as { errors?: Array<{ message?: string }> };
        setErrorMessage(
          clerkError.errors?.[0]?.message ?? "Invalid verification code.",
        );
      } else {
        setErrorMessage("Invalid verification code.");
      }
    } finally {
      setIsPending(false);
    }
  };

  if (!authLoaded || (authLoaded && isSignedIn)) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <Text style={styles.title}>Create your account</Text>
        <Text style={styles.subtitle}>
          Use an email and a password. We will send a one-time code to verify
          your address.
        </Text>

        {pendingVerification ? (
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Verification code</Text>
            <TextInput
              style={styles.input}
              placeholder="123456"
              keyboardType="number-pad"
              value={verificationCode}
              onChangeText={setVerificationCode}
              textContentType="oneTimeCode"
            />
          </View>
        ) : (
          <>
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="you@example.com"
                value={emailAddress}
                onChangeText={setEmailAddress}
                textContentType="emailAddress"
              />
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="At least 8 characters"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                textContentType="password"
              />
            </View>
          </>
        )}

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <Pressable
          style={[
            styles.ctaButton,
            isPrimaryActionDisabled && styles.ctaButtonDisabled,
          ]}
          onPress={pendingVerification ? handleVerification : handleSignUp}
          disabled={isPrimaryActionDisabled}
        >
          {isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.ctaLabel}>
              {pendingVerification ? "Verify email" : "Create account"}
            </Text>
          )}
        </Pressable>

        {!pendingVerification && (
          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account?</Text>
            <Link href="/" asChild>
              <Pressable>
                <Text style={styles.footerLink}>Sign in</Text>
              </Pressable>
            </Link>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  container: {
    flex: 1,
    padding: 24,
    gap: 16,
    justifyContent: "center",
  },
  loaderContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 28,
    fontWeight: "600",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    color: "#60646c",
    textAlign: "center",
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: "#ffffff",
  },
  error: {
    color: "#dc2626",
    fontSize: 14,
  },
  ctaButton: {
    borderRadius: 10,
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    alignItems: "center",
  },
  ctaButtonDisabled: {
    backgroundColor: "#93c5fd",
  },
  ctaLabel: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
  },
  footerText: {
    fontSize: 14,
    color: "#60646c",
  },
  footerLink: {
    fontSize: 14,
    fontWeight: "600",
    color: "#2563eb",
  },
});
