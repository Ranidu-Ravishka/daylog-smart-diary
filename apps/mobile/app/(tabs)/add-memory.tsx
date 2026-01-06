import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";

export default function AddMemoryScreen() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [mood, setMood] = useState("happy");

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });

    if (!result.canceled && result.assets[0].uri) {
      setSelectedImages([...selectedImages, result.assets[0].uri]);
    }
  };

  const handleSubmit = () => {
    // Handle memory submission
    console.log("Memory submitted:", {
      title,
      description,
      selectedImages,
      mood,
    });
    // Reset form
    setTitle("");
    setDescription("");
    setSelectedImages([]);
    setMood("happy");
    alert("Memory saved successfully!");
  };

  const moods = [
    { id: "happy", emoji: "😊", label: "Happy" },
    { id: "sad", emoji: "😢", label: "Sad" },
    { id: "excited", emoji: "🎉", label: "Excited" },
    { id: "peaceful", emoji: "😌", label: "Peaceful" },
    { id: "loved", emoji: "❤️", label: "Loved" },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Add New Memory</Text>
          <Text style={styles.subtitle}>Capture this moment</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Memory Title</Text>
            <TextInput
              style={styles.input}
              placeholder="Give your memory a title"
              value={title}
              onChangeText={setTitle}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Describe this memory..."
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>How are you feeling?</Text>
            <View style={styles.moodContainer}>
              {moods.map((item) => (
                <TouchableOpacity
                  key={item.id}
                  style={[
                    styles.moodButton,
                    mood === item.id && styles.moodButtonSelected,
                  ]}
                  onPress={() => setMood(item.id)}
                >
                  <Text style={styles.moodEmoji}>{item.emoji}</Text>
                  <Text
                    style={[
                      styles.moodLabel,
                      mood === item.id && styles.moodLabelSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Add Photos</Text>
            <TouchableOpacity style={styles.imageButton} onPress={pickImage}>
              <Text style={styles.imageButtonText}>+ Add Photo</Text>
            </TouchableOpacity>

            {selectedImages.length > 0 && (
              <ScrollView horizontal style={styles.imagesContainer}>
                {selectedImages.map((uri, index) => (
                  <View key={index} style={styles.imageWrapper}>
                    <Image source={{ uri }} style={styles.image} />
                    <TouchableOpacity
                      style={styles.removeImageButton}
                      onPress={() => {
                        const newImages = [...selectedImages];
                        newImages.splice(index, 1);
                        setSelectedImages(newImages);
                      }}
                    >
                      <Text style={styles.removeImageText}>×</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          <TouchableOpacity
            style={styles.submitButton}
            onPress={handleSubmit}
            disabled={!title.trim()}
          >
            <Text style={styles.submitButtonText}>Save Memory</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 20,
    backgroundColor: "white",
    marginBottom: 10,
  },
  title: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#333",
  },
  subtitle: {
    fontSize: 16,
    color: "#666",
    marginTop: 5,
  },
  form: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 24,
  },
  label: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    color: "#333",
  },
  input: {
    backgroundColor: "white",
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    fontSize: 16,
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: "top",
  },
  moodContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  moodButton: {
    backgroundColor: "white",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#ddd",
    alignItems: "center",
    minWidth: 80,
  },
  moodButtonSelected: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  moodEmoji: {
    fontSize: 24,
    marginBottom: 4,
  },
  moodLabel: {
    fontSize: 12,
    color: "#666",
  },
  moodLabelSelected: {
    color: "white",
    fontWeight: "600",
  },
  imageButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  imageButtonText: {
    color: "white",
    fontSize: 16,
    fontWeight: "600",
  },
  imagesContainer: {
    marginTop: 16,
  },
  imageWrapper: {
    position: "relative",
    marginRight: 12,
  },
  image: {
    width: 100,
    height: 100,
    borderRadius: 8,
  },
  removeImageButton: {
    position: "absolute",
    top: -8,
    right: -8,
    backgroundColor: "#ff3b30",
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  removeImageText: {
    color: "white",
    fontSize: 16,
    fontWeight: "bold",
  },
  submitButton: {
    backgroundColor: "#007AFF",
    padding: 18,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 20,
    opacity: 1,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
  },
});
