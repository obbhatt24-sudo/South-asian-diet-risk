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
