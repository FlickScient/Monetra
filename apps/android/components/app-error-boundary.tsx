import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type State = { failed: boolean };
export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Never log finance payloads or tokens from a render failure.
    console.error("MONETRA_NATIVE_RENDER_ERROR:", error.name);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.screen}>
        <View style={styles.mark}><Text style={styles.markText}>M</Text></View>
        <Text style={styles.title}>Monetra needs a fresh start</Text>
        <Text style={styles.copy}>A screen hit an unexpected error. Your locally saved finance data has not been cleared.</Text>
        <Pressable style={styles.button} onPress={() => this.setState({ failed: false })}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F4F3EC", alignItems: "center", justifyContent: "center", padding: 28 },
  mark: { width: 56, height: 56, borderRadius: 18, backgroundColor: "#596344", alignItems: "center", justifyContent: "center" },
  markText: { color: "#FFF", fontSize: 30, fontWeight: "800" },
  title: { color: "#20251D", fontSize: 21, fontWeight: "800", marginTop: 20, textAlign: "center" },
  copy: { color: "#788071", fontSize: 12, lineHeight: 19, marginTop: 9, textAlign: "center" },
  button: { backgroundColor: "#596344", borderRadius: 14, paddingVertical: 13, paddingHorizontal: 22, marginTop: 22 },
  buttonText: { color: "#FFF", fontSize: 12, fontWeight: "800" }
});
