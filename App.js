import {
  StyleSheet, Text, View, TextInput,
  TouchableOpacity, SafeAreaView, KeyboardAvoidingView,
  Platform, ActivityIndicator, ScrollView
} from 'react-native';
import { useState } from 'react';
import { GOOGLE_MAPS_API_KEY } from './Config';

export default function App() {
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState(null);
  const [error, setError] = useState(null);

  const previewRoute = async () => {
    setLoading(true);
    setError(null);
    setRouteData(null);

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=Randolph+MA&destination=${encodeURIComponent(destination)}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();

      if (data.status === 'OK') {
        const route = data.routes[0].legs[0];
        setRouteData({
          distance: route.distance.text,
          duration: route.duration.text,
          steps: route.steps.length,
          start: route.start_address,
          end: route.end_address,
        });
      } else {
        setError(`Could not find route: ${data.status}`);
      }
    } catch (err) {
      setError('Something went wrong. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.inner}>

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
            disabled={!destination || loading}
            onPress={previewRoute}
          >
            {loading
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.buttonText}>Preview My Route →</Text>
            }
          </TouchableOpacity>
        </View>

        {/* Error */}
        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* Route Result */}
        {routeData && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Route Found ✓</Text>

            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{routeData.duration}</Text>
                <Text style={styles.statLabel}>DRIVE TIME</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{routeData.distance}</Text>
                <Text style={styles.statLabel}>DISTANCE</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statValue}>{routeData.steps}</Text>
                <Text style={styles.statLabel}>TURNS</Text>
              </View>
            </View>

            <View style={styles.addressBlock}>
              <Text style={styles.addressLabel}>FROM</Text>
              <Text style={styles.addressText}>{routeData.start}</Text>
              <Text style={styles.addressLabel}>TO</Text>
              <Text style={styles.addressText}>{routeData.end}</Text>
            </View>
          </View>
        )}

        {/* Badge */}
        <View style={styles.badge}>
          <Text style={styles.badgeText}>🛡️  GPS Dead Zone Detection  •  AI Landmark Coaching</Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1B2A',
  },
  inner: {
    padding: 24,
    gap: 20,
  },
  header: {
    alignItems: 'center',
    paddingTop: 20,
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
  },
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
  },
  errorCard: {
    backgroundColor: '#3D1515',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#7F1D1D',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 14,
  },
  resultCard: {
    backgroundColor: '#1E2D3D',
    borderRadius: 20,
    padding: 24,
    gap: 20,
    borderWidth: 1,
    borderColor: '#2A3F55',
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4ADE80',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  stat: {
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64B5F6',
    letterSpacing: 1.2,
  },
  addressBlock: {
    gap: 6,
    backgroundColor: '#0D1B2A',
    borderRadius: 12,
    padding: 16,
  },
  addressLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64B5F6',
    letterSpacing: 1.5,
  },
  addressText: {
    fontSize: 13,
    color: '#CBD5E1',
    marginBottom: 8,
  },
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