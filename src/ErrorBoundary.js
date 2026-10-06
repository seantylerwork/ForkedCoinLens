import { Component } from "react";
import { SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import GoldCoin from "./components/GoldCoin";
import styles from "./theme/styles";

// Without this, any render-time error anywhere in the app (a bad API
// response shape, a null a screen didn't expect, etc.) crashes the whole
// tree to a blank/unrecoverable screen for the end user. This catches it
// and offers a way back in instead of a dead end.
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary] caught:", error, info?.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.safeArea}>
          <View style={styles.center}>
            <GoldCoin size={80} />
            <Text style={styles.pageTitle}>Something Went Wrong</Text>
            <Text style={styles.pageSubtitle}>Obverse ran into an unexpected error. Your account and saved scans are safe - try again.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={this.handleReset}>
              <Text style={styles.primaryBtnText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}
