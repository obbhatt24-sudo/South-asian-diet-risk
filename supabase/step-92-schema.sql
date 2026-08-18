-- Step 92 — Supabase schema for saved personal context
-- Run this in the Supabase SQL Editor (project: mucuqgwleccdhwrfrrjk).

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  height_cm      numeric,
  weight_kg      numeric,
  waist_cm       numeric,
  age_years      integer,
  sex            text DEFAULT 'male',
  sedentary_hrs  numeric DEFAULT 8,
  context        text DEFAULT 'india',
  t1d            boolean DEFAULT false,
  updated_at     timestamptz DEFAULT now()
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own profile"
  ON user_profiles FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
