import {
  StyleSheet, Text, View, Image,
  TouchableOpacity, SafeAreaView,
  ActivityIndicator, Dimensions
} from 'react-native';
import { useEffect, useState } from 'react';
import { GOOGLE_MAPS_API_KEY } from './Config';

const { width } = Dimensions.get('window');

const METADATA_TIMEOUT_MS = 10000;

// checking = probing coverage, loading = image fetching,
// ready = image shown, unavailable = no imagery / load failed
const STATUS = {
  CHECKING: 'checking',
  LOADING: 'loading',
  READY: 'ready',
  UNAVAILABLE: 'unavailable',
};

export default function StreetPreview({ route, onBack }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [status, setStatus] = useState(STATUS.CHECKING);

  const waypoints = Array.isArray(route?.waypoints) ? route.waypoints : [];
  const total = waypoints.length;
  const safeStep = Math.min(currentStep, Math.max(total - 1, 0));
  const current = waypoints[safeStep];

  useEffect(() => {
    if (!current) return undefined;

    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);

    setStatus(STATUS.CHECKING);

    // Google answers the image endpoint with HTTP 200 and a grey "no imagery"
    // placeholder when a location has no coverage, so onError never fires for
    // it. The metadata endpoint is the only way to detect that case up front.
    (async () => {
      try {
        const response = await fetch(
          `https://maps.googleapis.com/maps/api/streetview/metadata?location=${current.lat},${current.lng}&key=${GOOGLE_MAPS_API_KEY}`,
          { signal: controller.signal }
        );
        if (cancelled) return;

        if (!response.ok) {
          setStatus(STATUS.LOADING);
          return;
        }

        const data = await response.json();
        if (cancelled) return;

        setStatus(data?.status === 'OK' ? STATUS.LOADING : STATUS.UNAVAILABLE);
      } catch (err) {
        // A network error on the probe is not proof there is no coverage.
        // Let the image attempt proceed and fall back on its onError instead.
        if (!cancelled) setStatus(STATUS.LOADING);
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [current?.lat, current?.lng]);

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

  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${current.lat},${current.lng}&fov=90&heading=${current.heading || 0}&pitch=0&key=${GOOGLE_MAPS_API_KEY}`;

  const goNext = () => {
    if (safeStep < total - 1) setCurrentStep(safeStep + 1);
  };

  const goPrev = () => {
    if (safeStep > 0) setCurrentStep(safeStep - 1);
  };

  return (
    <SafeAreaView style={styles.container}>

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Route Preview</Text>
        <Text style={styles.stepCount}>{safeStep + 1} / {total}</Text>
      </View>

      {/* Street View Image */}
      <View style={styles.imageContainer}>
        {status === STATUS.UNAVAILABLE ? (
          <View style={styles.imageFallback}>
            <Text style={styles.fallbackIcon}>🛰️</Text>
            <Text style={styles.fallbackTitle}>No Street View here</Text>
            <Text style={styles.fallbackText}>
              Google has no imagery for this point. The turn directions below still apply.
            </Text>
          </View>
        ) : (
          <>
            {status !== STATUS.READY && (
              <View style={styles.loadingOverlay}>
                <ActivityIndicator size="large" color="#64B5F6" />
                <Text style={styles.loadingText}>Loading view...</Text>
              </View>
            )}
            {status !== STATUS.CHECKING && (
              <Image
                key={streetViewUrl}
                source={{ uri: streetViewUrl }}
                style={styles.streetImage}
                // onLoadEnd fires after onError too, so never let it
                // overwrite a failure back into a "ready" state.
                onLoadEnd={() => setStatus((prev) => (
                  prev === STATUS.UNAVAILABLE ? prev : STATUS.READY
                ))}
                onError={() => setStatus(STATUS.UNAVAILABLE)}
                resizeMode="cover"
              />
            )}
          </>
        )}
      </View>

      {/* Step Info */}
      <View style={styles.infoCard}>
        <Text style={styles.stepLabel}>STOP {safeStep + 1}</Text>
        <Text style={styles.stepName}>{current.instruction || 'Continue on route'}</Text>
        {current.isDeadZone && (
          <View style={styles.deadZoneBadge}>
            <Text style={styles.deadZoneBadgeText}>⚠️ GPS Dead Zone Ahead</Text>
          </View>
        )}
      </View>

      {/* Progress Bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${((safeStep + 1) / total) * 100}%` }]} />
      </View>

      {/* Navigation Buttons */}
      <View style={styles.navRow}>
        <TouchableOpacity
          style={[styles.navButton, safeStep === 0 && styles.navDisabled]}
          onPress={goPrev}
          disabled={safeStep === 0}
        >
          <Text style={styles.navText}>← Previous</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navButton, styles.navPrimary, safeStep === total - 1 && styles.navDisabled]}
          onPress={goNext}
          disabled={safeStep === total - 1}
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
  imageFallback: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    gap: 8,
  },
  fallbackIcon: {
    fontSize: 32,
  },
  fallbackTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  fallbackText: {
    color: '#8CA3B8',
    fontSize: 13,
    textAlign: 'center',
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
