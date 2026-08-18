// Supabase configuration
// The anon key is safe to commit — RLS protects user data
const SUPABASE_URL  = 'https://mucuqgwleccdhwrfrrjk.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11Y3VxZ3dsZWNjZGh3cmZycmprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU3OTM0NjMsImV4cCI6MjEwMTM2OTQ2M30.snOJzl9QKFvUb80UxQTxrP4MUkpjpMBGeKp1EpdMRzY';

const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Auth helpers ──────────────────────────────────────

async function getCurrentUser() {
  const { data: { user } } = await _supabase.auth.getUser();
  return user;
}

async function signInWithEmail(email, password) {
  return _supabase.auth.signInWithPassword({ email, password });
}

async function signUpWithEmail(email, password) {
  return _supabase.auth.signUp({ email, password });
}

async function signInWithGoogle() {
  return _supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });
}

async function signOut() {
  return _supabase.auth.signOut();
}

function onAuthStateChange(callback) {
  return _supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
}

// ── Meal storage helpers ──────────────────────────────

async function saveMeal(mealData) {
  const user = await getCurrentUser();
  if (!user) return { error: { message: 'Not signed in' } };
  return _supabase.from('meals').insert({
    user_id: user.id,
    ...mealData
  });
}

async function getRecentMeals(limit = 30) {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return _supabase
    .from('meals')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit);
}

async function deleteMeal(mealId) {
  return _supabase.from('meals').delete().eq('id', mealId);
}

// ── Pantry helpers ────────────────────────────────────

async function addToPantry(productData) {
  const user = await getCurrentUser();
  if (!user) return { error: { message: 'Not signed in' } };
  return _supabase.from('pantry_items').insert({
    user_id: user.id, ...productData
  });
}

async function getPantryItems() {
  const user = await getCurrentUser();
  if (!user) return { data: [], error: null };
  return _supabase.from('pantry_items')
    .select('*')
    .eq('user_id', user.id)
    .order('last_used_at', { ascending: false, nullsFirst: false });
}

async function updatePantryServings(itemId, servingsUsed) {
  return _supabase.from('pantry_items')
    .update({ servings_used: servingsUsed, last_used_at: new Date().toISOString() })
    .eq('id', itemId);
}

async function deletePantryItem(itemId) {
  return _supabase.from('pantry_items').delete().eq('id', itemId);
}

// ── Personal context profile helpers ──────────────────

async function loadUserProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  const { data } = await _supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();
  return data;
}

async function saveUserProfile(profileData) {
  const user = await getCurrentUser();
  if (!user) return;
  await _supabase
    .from('user_profiles')
    .upsert({
      user_id: user.id,
      ...profileData,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
}
