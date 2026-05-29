import { StatusBar } from 'expo-status-bar';
import {
  StyleSheet, Text, View, TextInput,
  TouchableOpacity, SafeAreaView, KeyboardAvoidingView, Platform
} from 'react-native';
import { useState } from 'react';

export default function App() {
  const [destination, setDestination] = useState('');

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.inner}
      >

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.logo}>RouteReady</Text>
          <Text style={styles.tagline}>Know the road before you drive it.</Text>
        </View>

        {/* Input Card */}
        <View style={styles.card}>
          <Text style={styles.label}>WHERE ARE YOU HEADED?</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your destination..."
            placeholderTextColor="#64748B"
            value={destination}
            onChangeText={setDestination}
          />

          <TouchableOpacity
            style={[styles.button, !destination && styles.buttonDisabled]}
            disabled={!destination}
            onPress={() => alert(`Previewing route to: ${destination}`)}
          >
            <Text style={styles.buttonText}>Preview My Route →</Text>
          </TouchableOpacity>
        </View>

        {/* Confidence Badge */}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>🛡️  GPS Dead Zone Detection  •  AI Landmark Coaching</Text>
        </View>

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1B2A',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 24,
  },

  // Header
  header: {
    alignItems: 'center',
    gap: 8,
  },
  logo: {
    fontSize: 42,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -1,
  },
  tagline: {
    fontSize: 16,
    color: '#64B5F6',
    fontWeight: '400',
    letterSpacing: 0.3,
  },

  // Card
  card: {
    backgroundColor: '#1E2D3D',
    borderRadius: 20,
    padding: 24,
    gap: 16,
    borderWidth: 1,
    borderColor: '#2A3F55',
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64B5F6',
    letterSpacing: 1.5,
  },
  input: {
    backgroundColor: '#0D1B2A',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#2A3F55',
  },
  button: {
    backgroundColor: '#1565C0',
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#1E2D3D',
    borderWidth: 1,
    borderColor: '#2A3F55',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Badge
  badge: {
    backgroundColor: '#1E2D3D',
    borderRadius: 100,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A3F55',
  },
  badgeText: {
    color: '#64B5F6',
    fontSize: 12,
    fontWeight: '500',
  },
});
