import {
  StyleSheet, Text, View, Image,
  TouchableOpacity, SafeAreaView,
  ActivityIndicator, Dimensions, ScrollView
} from 'react-native';
import { useState } from 'react';
import { GOOGLE_MAPS_API_KEY } from './Config';

const { width } = Dimensions.get('window');

export default function StreetPreview({ route, onBack }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [imageLoading, setImageLoading] = useState(true);

  const waypoints = route.waypoints || [];
  const total = waypoints.length;

  if (total === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <Text style={styles.errorText}>No preview available for this route.</Text>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const current = waypoints[currentStep];
  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${current.lat},${current.lng}&fov=90&heading=${current.heading || 0}&pitch=0&key=${GOOGLE_MAPS_API_KEY}`;

  const goNext = () => {
    if (currentStep < total - 1) setCurrentStep(currentStep + 1);
  };

  const goPrev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Route Preview</Text>
        <Text style={styles.stepCount}>{currentStep + 1} / {total}</Text>
      </View>

      {/* Street View Image */}
      <View style={styles.imageContainer}>
        {imageLoading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#64B5F6" />
            <Text style={styles.loadingText}>Loading view...</Text>
          </View>
        )}
        <Image
          source={{ uri: streetViewUrl }}
          style={styles.streetImage}
          onLoadStart={() => setImageLoading(true)}
          onLoadEnd={() => setImageLoading(false)}
          resizeMode="cover"
        />
      </View>

      {/* Step Info */}
      <View style={styles.infoCard}>
        <Text style={styles.stepLabel}>STOP {currentStep + 1}</Text>
        <Text style={styles.stepName}>{current.instruction || 'Continue on route'}</Text>
        {current.isDeadZone && (
          <View style={styles.deadZoneBadge}>
            <Text style={styles.deadZoneBadgeText}>⚠️ GPS Dead Zone Ahead</Text>
          </View>
        )}
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${((currentStep + 1) / total) * 100}%` }]} />
      </View>

      {/* Navigation Buttons */}
      <View style={styles.navRow}>
        <TouchableOpacity
          style={[styles.navButton, currentStep === 0 && styles.navDisabled]}
          onPress={goPrev}
          disabled={currentStep === 0}
        >
          <Text style={styles.navText}>← Previous</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navButton, styles.navPrimary, currentStep === total - 1 && styles.navDisabled]}
          onPress={goNext}
          disabled={currentStep === total - 1}
        >
          <Text style={[styles.navText, styles.navPrimaryText]}>Next →</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1B2A',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3F55',
  },
  backButton: {
    padding: 8,
  },
  backText: {
    color: '#64B5F6',
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  stepCount: {
    color: '#64B5F6',
    fontSize: 14,
    fontWeight: '600',
  },
  imageContainer: {
    width: width,
    height: 280,
    backgroundColor: '#1E2D3D',
    position: 'relative',
  },
  streetImage: {
    width: '100%',
    height: '100%',
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
    backgroundColor: '#1E2D3D',
    gap: 12,
  },
  loadingText: {
    color: '#64B5F6',
    fontSize: 14,
  },
  infoCard: {
    margin: 20,
    backgroundColor: '#1E2D3D',
    borderRadius: 16,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2A3F55',
  },
  stepLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#64B5F6',
    letterSpacing: 1.5,
  },
  stepName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  deadZoneBadge: {
    backgroundColor: '#2D1A0E',
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: '#92400E',
    marginTop: 4,
  },
  deadZoneBadgeText: {
    color: '#FB923C',
    fontSize: 13,
    fontWeight: '600',
  },
  progressBar: {
    height: 4,
    backgroundColor: '#1E2D3D',
    marginHorizontal: 20,
    borderRadius: 2,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#1565C0',
    borderRadius: 2,
  },
  navRow: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
  },
  navButton: {
    flex: 1,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#1E2D3D',
    borderWidth: 1,
    borderColor: '#2A3F55',
  },
  navPrimary: {
    backgroundColor: '#1565C0',
    borderColor: '#1565C0',
  },
  navDisabled: {
    opacity: 0.4,
  },
  navText: {
    color: '#64B5F6',
    fontSize: 15,
    fontWeight: '700',
  },
  navPrimaryText: {
    color: '#FFFFFF',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 16,
    textAlign: 'center',
    marginTop: 40,
  },
});