// GPS dead zone coaching, proxied through Supabase so the Anthropic API key
// stays server-side and never ships in the app bundle.
//
// This is deliberately NOT a generic passthrough proxy. The client sends only a
// tunnel name; the model, the prompt and the token ceiling are owned here. A
// passthrough would move the key off the device but leave an open LLM relay
// that anyone could drive with arbitrary prompts.
import Anthropic from 'npm:@anthropic-ai/sdk@0.122.0';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 150;
const MAX_ZONE_NAME_LENGTH = 120;

// Best-effort throttle. Edge Functions run as many isolates, so this bounds one
// instance, not the project. It is a speed bump against a hot loop, not a quota
// - see README.md for the durable (Redis-backed) option.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const RATE_LIMIT_MAX_TRACKED_IPS = 5_000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status: number, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });

// Supabase injects the project's own keys. verify_jwt is off for this function
// (the app has no Supabase Auth, so there is no user JWT to verify), so we do
// the equivalent check here: the caller must present a real project key.
const projectKeys: Set<string> = (() => {
  const keys = new Set<string>();

  const legacyAnon = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacyAnon) keys.add(legacyAnon);

  try {
    const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}');
    for (const value of Object.values(publishable)) {
      if (typeof value === 'string' && value) keys.add(value);
    }
  } catch {
    // Malformed or absent - the legacy key above is then the only accepted one.
  }

  return keys;
})();

const presentedKey = (req: Request): string | null => {
  const apikey = req.headers.get('apikey');
  if (apikey) return apikey;

  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim() || null;

  return null;
};

const recentHits = new Map<string, number[]>();

const isRateLimited = (clientId: string): boolean => {
  const now = Date.now();
  const recent = (recentHits.get(clientId) ?? []).filter((at) => now - at < RATE_LIMIT_WINDOW_MS);

  recent.push(now);

  // Crude memory bound - this map is per-isolate and short-lived anyway.
  if (recentHits.size > RATE_LIMIT_MAX_TRACKED_IPS) recentHits.clear();
  recentHits.set(clientId, recent);

  return recent.length > RATE_LIMIT_MAX_REQUESTS;
};

const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
const anthropic = anthropicKey ? new Anthropic({ apiKey: anthropicKey }) : null;

const buildPrompt = (zoneName: string) =>
  `You are a calm driving coach. A driver is about to lose GPS signal entering "${zoneName}". `
  + 'Give them ONE specific, practical coaching tip in 2 sentences max. '
  + 'Tell them what lane to stay in and what landmark to look for. '
  + 'Be direct and confident. No fluff.';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const key = presentedKey(req);
  if (!key || !projectKeys.has(key)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const clientId = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (isRateLimited(clientId)) {
    return json({ error: 'Too many requests' }, 429, { 'Retry-After': '60' });
  }

  if (!anthropic) {
    // Misconfiguration, not a caller error. Never echo key material.
    console.error('ANTHROPIC_API_KEY is not set for this function');
    return json({ error: 'Coaching is not configured' }, 500);
  }

  let zoneName: unknown;
  try {
    const body = await req.json();
    zoneName = body?.zoneName;
  } catch {
    return json({ error: 'Body must be JSON' }, 400);
  }

  if (typeof zoneName !== 'string' || zoneName.trim() === '') {
    return json({ error: 'zoneName is required' }, 400);
  }

  // Bound what reaches the prompt. The caller controls only this one value.
  const safeZoneName = zoneName
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ZONE_NAME_LENGTH);

  // Sanitizing can empty a string that was only control characters.
  if (!safeZoneName) {
    return json({ error: 'zoneName is required' }, 400);
  }

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: buildPrompt(safeZoneName) }],
    });

    // content is a discriminated union - narrow before reading .text.
    const coaching = message.content
      .map((block) => (block.type === 'text' ? block.text : ''))
      .join('')
      .trim();

    if (!coaching) {
      return json({ error: 'Empty response from model' }, 502);
    }

    return json({ coaching }, 200);
  } catch (error) {
    // Typed SDK errors, most specific first.
    if (error instanceof Anthropic.RateLimitError) {
      console.error('Anthropic rate limit hit');
      return json({ error: 'Upstream rate limit' }, 429, { 'Retry-After': '5' });
    }

    if (error instanceof Anthropic.AuthenticationError) {
      console.error('Anthropic rejected the configured API key');
      return json({ error: 'Coaching is not configured' }, 500);
    }

    if (error instanceof Anthropic.APIError) {
      console.error(`Anthropic API error ${error.status}`);
      return json({ error: 'Upstream error' }, 502);
    }

    console.error('Unexpected coaching failure:', error);
    return json({ error: 'Unexpected error' }, 500);
  }
});
