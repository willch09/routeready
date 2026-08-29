import {
  StyleSheet, Text, View, TextInput,
  TouchableOpacity, SafeAreaView,
  ActivityIndicator, ScrollView
} from 'react-native';
import { useState } from 'react';
import StreetPreview from './StreetPreview';
import { GOOGLE_MAPS_API_KEY, ANTHROPIC_API_KEY } from './Config';
import polyline from '@mapbox/polyline';

// A waypoint this close to a tunnel midpoint counts as being in the zone.
const DEAD_ZONE_PROXIMITY_METERS = 200;
// Hard ceiling on Claude calls per route, so a tunnel-heavy route cannot
// fan out into dozens of requests.
const MAX_COACHED_ZONES = 8;
// Spacing between sequential Claude calls.
const COACHING_GAP_MS = 350;
const REQUEST_TIMEOUT_MS = 15000;
const OVERPASS_TIMEOUT_MS = 25000;
const MAX_DESTINATION_LENGTH = 200;

const COACHING_FALLBACK = 'Stay alert and note your surroundings before signal drops.';

const DIRECTIONS_STATUS_MESSAGES = {
  ZERO_RESULTS: 'No driving route found to that destination. Try a more specific address.',
  NOT_FOUND: 'We could not find that destination. Check the spelling and try again.',
  OVER_QUERY_LIMIT: 'Too many route lookups right now. Wait a moment and try again.',
  OVER_DAILY_LIMIT: 'Route lookups are unavailable right now (daily quota reached).',
  REQUEST_DENIED: 'Route lookup was denied. Check the Google Maps API key configuration.',
  INVALID_REQUEST: 'That destination could not be read. Try a different address.',
  MAX_ROUTE_LENGTH_EXCEEDED: 'That route is too long to preview.',
  UNKNOWN_ERROR: 'Google Maps had a temporary error. Try again.',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Every network call goes through this, so a hung request cannot leave the
// app spinning forever.
const fetchWithTimeout = async (url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

// Free text -> safe query string. It is still URL-encoded at the call site;
// this strips control characters, collapses whitespace and caps length so a
// pathological paste cannot build a giant URL.
const sanitizeDestination = (raw) => {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DESTINATION_LENGTH);
};

// Google returns turn text as HTML; React Native Text renders it literally.
const stripHtml = (value) => (
  typeof value === 'string' ? value.replace(/<[^>]*>/g, '').trim() : ''
);

const tunnelMidpoint = (tunnel) => {
  const geometry = tunnel?.geometry;
  if (!Array.isArray(geometry) || geometry.length === 0) return null;
  return geometry[Math.floor(geometry.length / 2)] || null;
};

// Check if a point is close enough to the route line
const isNearRoute = (tunnelLat, tunnelLng, routePoints, thresholdMeters = 50) => {
  for (let i = 0; i < routePoints.length - 1; i++) {
    const lat1 = routePoints[i][0];
    const lng1 = routePoints[i][1];
    const lat2 = routePoints[i + 1][0];
    const lng2 = routePoints[i + 1][1];
    const dist = pointToSegmentDistance(tunnelLat, tunnelLng, lat1, lng1, lat2, lng2);
    if (dist < thresholdMeters) return true;
  }
  return false;
};

// Calculate distance in meters between a point and a line segment
const pointToSegmentDistance = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq !== 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const nearX = ax + t * dx;
  const nearY = ay + t * dy;
  return haversineDistance(px, py, nearX, nearY);
};

// Haversine formula - converts lat/lng difference to meters
const haversineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// True when a waypoint sits within DEAD_ZONE_PROXIMITY_METERS of any
// detected tunnel midpoint.
const isNearDeadZone = (lat, lng, zones) => zones.some((zone) => {
  const midPoint = tunnelMidpoint(zone);
  if (!midPoint) return false;
  return haversineDistance(lat, lng, midPoint.lat, midPoint.lon) <= DEAD_ZONE_PROXIMITY_METERS;
});

const parseRetryAfterMs = (headerValue) => {
  const seconds = Number(headerValue);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10000);
  return null;
};

// Never throws. Returns { coaching, failed, retryable, retryAfterMs } so the
// caller can tell a real tip from the static fallback.
const getCoachingScript = async (zoneName) => {
  try {
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `You are a calm driving coach. A driver is about to lose GPS signal entering "${zoneName}". 
          Give them ONE specific, practical coaching tip in 2 sentences max. 
          Tell them what lane to stay in and what landmark to look for. 
          Be direct and confident. No fluff.`
        }]
      })
    });

    if (!response.ok) {
      return {
        coaching: COACHING_FALLBACK,
        failed: true,
        // 429 and 5xx are worth one retry; 400/401/403 are not.
        retryable: response.status === 429 || response.status >= 500,
        retryAfterMs: parseRetryAfterMs(response.headers?.get?.('retry-after')),
      };
    }

    const data = await response.json();
    // An error payload has no content array - reading content[0].text
    // directly threw a TypeError here.
    const text = data?.content?.[0]?.text;

    if (typeof text !== 'string' || text.trim() === '') {
      return { coaching: COACHING_FALLBACK, failed: true, retryable: false, retryAfterMs: null };
    }

    return { coaching: text.trim(), failed: false, retryable: false, retryAfterMs: null };
  } catch (err) {
    return { coaching: COACHING_FALLBACK, failed: true, retryable: true, retryAfterMs: null };
  }
};

// Sequential on purpose: Promise.all fired one Claude request per dead zone
// simultaneously, which trips rate limits on tunnel-heavy routes.
const coachDeadZones = async (tunnels) => {
  const coached = [];
  let coachingFailures = 0;

  const targets = tunnels.slice(0, MAX_COACHED_ZONES);

  for (let i = 0; i < targets.length; i++) {
    const zone = targets[i];
    const name = zone.tags?.name || zone.tags?.description || 'this tunnel';

    if (i > 0) await sleep(COACHING_GAP_MS);

    let outcome = await getCoachingScript(name);

    if (outcome.failed && outcome.retryable) {
      await sleep(outcome.retryAfterMs ?? 1500);
      outcome = await getCoachingScript(name);
    }

    if (outcome.failed) coachingFailures += 1;
    coached.push({ ...zone, coaching: outcome.coaching });
  }

  // Zones past the cap still render, with the static tip.
  for (const zone of tunnels.slice(MAX_COACHED_ZONES)) {
    coached.push({ ...zone, coaching: COACHING_FALLBACK });
  }

  return { zones: coached, coachingFailures };
};

// Returns { tunnels, failed }. An empty list because the scan failed is NOT
// the same as an empty list because the route is clear.
const getDeadZones = async (points) => {
  const lats = points.map(p => p[0]);
  const lngs = points.map(p => p[1]);
  const south = Math.min(...lats);
  const north = Math.max(...lats);
  const west = Math.min(...lngs);
  const east = Math.max(...lngs);

  const query = `
    [out:json];
    (
      way["tunnel"="yes"]["highway"~"motorway|trunk|primary|secondary|tertiary"](${south},${west},${north},${east});
    );
    out geom;
  `;

  try {
    const response = await fetchWithTimeout(
      'https://overpass-api.de/api/interpreter',
      { method: 'POST', body: query },
      OVERPASS_TIMEOUT_MS
    );

    if (!response.ok) return { tunnels: [], failed: true };

    const data = await response.json();
    const allTunnels = Array.isArray(data?.elements) ? data.elements : [];

   // Filter to only tunnels actually ON the route
    const onRoute = allTunnels.filter(tunnel => {
      const midPoint = tunnelMidpoint(tunnel);
      if (!midPoint) return false;
      return isNearRoute(midPoint.lat, midPoint.lon, points, 5);
    });

    // Deduplicate by name
    const seen = new Set();
    const deduplicated = onRoute.filter(tunnel => {
      const name = tunnel.tags?.name || tunnel.tags?.description || 'unnamed';
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    });

    return { tunnels: deduplicated, failed: false };
  } catch (err) {
    return { tunnels: [], failed: true };
  }
};

export default function App() {
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState(null);
  const [deadZones, setDeadZones] = useState([]);
  const [error, setError] = useState(null);
const [showPreview, setShowPreview] = useState(false);
const [waypoints, setWaypoints] = useState([]);
const [scanWarning, setScanWarning] = useState(null);

const calculateHeading = (from, to) => {
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const lat1 = from.lat * Math.PI / 180;
  const lat2 = to.lat * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};

  const previewRoute = async () => {
    const query = sanitizeDestination(destination);

    if (!query) {
      setError('Enter a destination first.');
      return;
    }

    setLoading(true);
    setError(null);
    setScanWarning(null);
    setRouteData(null);
    setDeadZones([]);
    setWaypoints([]);

    try {
      const response = await fetchWithTimeout(
        `https://maps.googleapis.com/maps/api/directions/json?origin=Randolph+MA&destination=${encodeURIComponent(query)}&key=${GOOGLE_MAPS_API_KEY}`
      );

      if (!response.ok) {
        setError('Could not reach the route service. Check your connection and try again.');
        return;
      }

      const data = await response.json();

      if (data.status !== 'OK') {
        setError(
          DIRECTIONS_STATUS_MESSAGES[data.status]
          || 'Could not find a route to that destination.'
        );
        return;
      }

      const route = data?.routes?.[0]?.legs?.[0];
      const encoded = data?.routes?.[0]?.overview_polyline?.points;

      if (!route || !encoded) {
        setError('That route came back incomplete. Try a different destination.');
        return;
      }

      // Decode the polyline into GPS coordinates
      const points = polyline.decode(encoded);

      // Drop any step missing coordinates rather than crashing on it later
      const steps = (Array.isArray(route.steps) ? route.steps : []).filter((step) => (
        Number.isFinite(step?.end_location?.lat) && Number.isFinite(step?.end_location?.lng)
      ));

      // Scan for dead zones
      const scan = await getDeadZones(points);

      // Get AI coaching for each dead zone (sequential - see coachDeadZones)
      const { zones, coachingFailures } = await coachDeadZones(scan.tunnels);

      // Extract waypoints from steps for Street View, flagging any that fall
      // within DEAD_ZONE_PROXIMITY_METERS of a detected tunnel.
      const routeWaypoints = steps.map((step, index) => {
        const lat = step.end_location.lat;
        const lng = step.end_location.lng;

        return {
          lat,
          lng,
          instruction: stripHtml(step.html_instructions),
          heading: index > 0 ? calculateHeading(
            steps[index - 1].end_location,
            step.end_location
          ) : 0,
          isDeadZone: isNearDeadZone(lat, lng, zones),
        };
      });

      setWaypoints(routeWaypoints);
      setRouteData({
        distance: route.distance?.text ?? '--',
        duration: route.duration?.text ?? '--',
        steps: steps.length,
        start: route.start_address ?? 'Unknown origin',
        end: route.end_address ?? query,
      });
      setDeadZones(zones);

      // Say so when the result is degraded, instead of implying a clear route.
      if (scan.failed) {
        setScanWarning(
          'Dead zone scan unavailable - we could not reach the tunnel database, '
          + 'so this route has not been checked for GPS dead zones.'
        );
      } else if (coachingFailures > 0) {
        setScanWarning(
          `AI coaching unavailable for ${coachingFailures} of ${zones.length} dead `
          + 'zone(s) - showing standard guidance for those instead.'
        );
      }
    } catch (err) {
      setError('Something went wrong. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

 if (showPreview) {
  return (
    <StreetPreview
      route={{ waypoints }}
      onBack={() => setShowPreview(false)}
    />
  );
}

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
            maxLength={MAX_DESTINATION_LENGTH}
            returnKeyType="search"
            onSubmitEditing={previewRoute}
          />
          <TouchableOpacity
            style={[styles.button, !destination.trim() && styles.buttonDisabled]}
            disabled={!destination.trim() || loading}
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

        {/* Degraded result - partial data, not a clean pass */}
        {scanWarning && (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>⚠️  {scanWarning}</Text>
          </View>
        )}

        {/* Route Result */}
        {routeData && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>Route Found ✓</Text>
<TouchableOpacity
  style={styles.previewButton}
  onPress={() => setShowPreview(true)}
>
  <Text style={styles.previewButtonText}>👁  View Street Preview →</Text>
</TouchableOpacity>

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

        {/* Dead Zones */}
        {deadZones.length > 0 && (
          <View style={styles.deadZoneSection}>
            <Text style={styles.deadZoneTitle}>
              ⚠️  {deadZones.length} GPS Dead Zone{deadZones.length > 1 ? 's' : ''} Detected
            </Text>
            {deadZones.map((zone, index) => (
              <View key={index} style={styles.deadZoneCard}>
                <Text style={styles.deadZoneLabel}>DEAD ZONE {index + 1}</Text>
                <Text style={styles.deadZoneName}>
                  {zone.tags?.name || zone.tags?.description || 'Tunnel — GPS signal will drop'}
                </Text>
                <Text style={styles.deadZoneAdvice}>
  📍 {zone.coaching || 'Stay alert and note your surroundings before signal drops.'}
</Text>
              </View>
            ))}
          </View>
        )}

        {/* No Dead Zones - only claim this when the scan actually ran */}
        {routeData && deadZones.length === 0 && !scanWarning && (
          <View style={styles.clearCard}>
            <Text style={styles.clearText}>✅  No GPS dead zones on this route</Text>
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
  deadZoneSection: {
    gap: 12,
  },
  deadZoneTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FB923C',
  },
  deadZoneCard: {
    backgroundColor: '#2D1A0E',
    borderRadius: 16,
    padding: 20,
    gap: 8,
    borderWidth: 1,
    borderColor: '#92400E',
  },
  deadZoneLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FB923C',
    letterSpacing: 1.5,
  },
  deadZoneName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FED7AA',
  },
  deadZoneAdvice: {
    fontSize: 13,
    color: '#9A7B6A',
  },
  clearCard: {
    backgroundColor: '#0F2D1A',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#166534',
    alignItems: 'center',
  },
  clearText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#4ADE80',
  },
  warningCard: {
    backgroundColor: '#2D1A0E',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#92400E',
  },
  warningText: {
    color: '#FED7AA',
    fontSize: 14,
  },

previewButton: {
  backgroundColor: '#0D2D4A',
  borderRadius: 10,
  padding: 14,
  alignItems: 'center',
  borderWidth: 1,
  borderColor: '#1565C0',
},
previewButtonText: {
  color: '#64B5F6',
  fontSize: 14,
  fontWeight: '700',
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