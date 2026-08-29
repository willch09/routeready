// Copy this file to Config.js and fill in your own values.
// Config.js is gitignored and must never be committed.
//
// Everything here ships inside the app bundle and is readable by anyone who
// installs the app. Only publishable/restrictable keys belong in this file.
// The Anthropic API key is NOT here on purpose - it lives as a Supabase
// project secret and is used only by the `coaching` Edge Function.
// See supabase/README.md.
export const GOOGLE_MAPS_API_KEY = 'YOUR_GOOGLE_MAPS_API_KEY_HERE';
export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY_HERE';
