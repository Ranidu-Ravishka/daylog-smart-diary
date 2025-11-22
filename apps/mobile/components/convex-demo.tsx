import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useQuery, useMutation } from "convex/react";
import { api } from "@repo/backend/convex";
import { useState } from "react";

export default function ConvexDemo() {
  const [inputValue, setInputValue] = useState("");
  const data = useQuery(api.myFunctions.myQuery, {
    first: 77,
    second: "Mobile App",
  });
  const myMutation = useMutation(api.myFunctions.myMutation);

  const handleMutation = async () => {
    await myMutation({
      first: Math.floor(Math.random() * 100),
      second: inputValue || "Hello from Mobile!",
    });
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mobile App - Convex Demo</Text>

      <View style={styles.resultBox}>
        <Text style={styles.subtitle}>Query Result:</Text>
        <Text style={styles.code}>{JSON.stringify(data, null, 2)}</Text>
      </View>

      <View style={styles.inputSection}>
        <Text style={styles.subtitle}>Test Mutation:</Text>
        <TextInput
          style={styles.input}
          value={inputValue}
          onChangeText={setInputValue}
          placeholder="Enter a message"
        />
        <TouchableOpacity style={styles.button} onPress={handleMutation}>
          <Text style={styles.buttonText}>Send Mutation</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoBold}>✅ Convex is connected!</Text>
        <Text style={styles.infoText}>
          This component uses the shared Convex backend from packages/backend
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 20,
  },
  resultBox: {
    marginTop: 20,
    padding: 15,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 10,
  },
  code: {
    fontFamily: "monospace",
    fontSize: 12,
  },
  inputSection: {
    marginTop: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 10,
    borderRadius: 4,
    marginBottom: 10,
  },
  button: {
    backgroundColor: "#007AFF",
    padding: 12,
    borderRadius: 4,
    alignItems: "center",
  },
  buttonText: {
    color: "#fff",
    fontWeight: "600",
  },
  infoBox: {
    marginTop: 20,
    padding: 15,
    backgroundColor: "#e3f2fd",
    borderRadius: 4,
  },
  infoBold: {
    fontWeight: "bold",
    marginBottom: 5,
  },
  infoText: {
    fontSize: 14,
  },
});
