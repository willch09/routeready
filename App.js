import {
  StyleSheet, Text, View, TextInput,
  TouchableOpacity, SafeAreaView,
  ActivityIndicator, ScrollView
} from 'react-native';
import { useState } from 'react';
import { GOOGLE_MAPS_API_KEY, ANTHROPIC_API_KEY } from './Config';
import polyline from '@mapbox/polyline';

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

const getCoachingScript = async (zoneName) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
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
    const data = await response.json();
    return data.content[0].text;
  } catch (err) {
    return 'Stay alert and note your surroundings before signal drops.';
  }
};

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
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: query,
    });
    const data = await response.json();
    const allTunnels = data.elements || [];

   // Filter to only tunnels actually ON the route
    const onRoute = allTunnels.filter(tunnel => {
      if (!tunnel.geometry || tunnel.geometry.length === 0) return false;
      const midIndex = Math.floor(tunnel.geometry.length / 2);
      const midPoint = tunnel.geometry[midIndex];
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

    return deduplicated;
  } catch (err) {
    console.log('Overpass error:', err);
    return [];
  }
};

export default function App() {
  const [destination, setDestination] = useState('');
  const [loading, setLoading] = useState(false);
  const [routeData, setRouteData] = useState(null);
  const [deadZones, setDeadZones] = useState([]);
  const [error, setError] = useState(null);

  const previewRoute = async () => {
    setLoading(true);
    setError(null);
    setRouteData(null);
    setDeadZones([]);

    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/directions/json?origin=Randolph+MA&destination=${encodeURIComponent(destination)}&key=${GOOGLE_MAPS_API_KEY}`
      );
      const data = await response.json();

      if (data.status === 'OK') {
        const route = data.routes[0].legs[0];

        // Decode the polyline into GPS coordinates
        const encoded = data.routes[0].overview_polyline.points;
        const points = polyline.decode(encoded);

        // Scan for dead zones
const tunnels = await getDeadZones(points);

// Get AI coaching for each dead zone
const coached = await Promise.all(
  tunnels.map(async (zone) => {
    const name = zone.tags?.name || zone.tags?.description || 'this tunnel';
    const coaching = await getCoachingScript(name);
    return { ...zone, coaching };
  })
);

setRouteData({
          distance: route.distance.text,
          duration: route.duration.text,
          steps: route.steps.length,
          start: route.start_address,
          end: route.end_address,
        });

       setDeadZones(coached);

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

        {/* No Dead Zones */}
        {routeData && deadZones.length === 0 && (
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