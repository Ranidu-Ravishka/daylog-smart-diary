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
import { useAuth, useSignIn } from "@clerk/clerk-expo";

export default function SignInScreen() {
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const { isLoaded, signIn, setActive } = useSignIn();

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace("/");
    }
  }, [authLoaded, isSignedIn, router]);

  const isDisabled = useMemo(() => {
    return (
      !emailAddress.trim() || password.length < 8 || !isLoaded || isPending
    );
  }, [emailAddress, password, isLoaded, isPending]);

  const handleSignIn = async () => {
    if (!isLoaded) {
      return;
    }

    setIsPending(true);
    setErrorMessage(null);

    try {
      const result = await signIn.create({
        identifier: emailAddress.trim(),
        password,
      });

      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
        router.replace("/");
      } else {
        setErrorMessage(
          "Additional verification required. Complete it in the Clerk dashboard.",
        );
      }
    } catch (error: unknown) {
      if (typeof error === "object" && error !== null && "errors" in error) {
        const clerkError = error as { errors?: Array<{ message?: string }> };
        setErrorMessage(
          clerkError.errors?.[0]?.message ?? "Unable to sign in.",
        );
      } else {
        setErrorMessage("Unable to sign in.");
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
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.subtitle}>
          Sign in with the email and password you used for Clerk.
        </Text>

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
            placeholder="Your password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            textContentType="password"
          />
        </View>

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <Pressable
          style={[styles.ctaButton, isDisabled && styles.ctaButtonDisabled]}
          onPress={handleSignIn}
          disabled={isDisabled}
        >
          {isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.ctaLabel}>Sign in</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Need an account?</Text>
          <Link href="/" asChild>
            <Pressable>
              <Text style={styles.footerLink}>Sign up</Text>
            </Pressable>
          </Link>
        </View>
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
