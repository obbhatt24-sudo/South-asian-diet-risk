-- Step 63 — Supabase schema for ingredient & dish migration
-- Run this in the Supabase SQL Editor (project: mucuqgwleccdhwrfrrjk).
--
-- JSON-native envelope: each row stores the full ingredient/dish object exactly
-- as it appears in data/ingredients.json / data/dishes.json inside a `data`
-- jsonb column. Nothing in the app's scoring logic changes — data.js unwraps
-- row.data back to the original shape on load.

-- ─────────────────────────────────────────────────────────
-- ingredients
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ingredients (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  data        jsonb NOT NULL,
  status      text DEFAULT 'approved',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE ingredients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read approved ingredients"
  ON ingredients FOR SELECT
  USING (status = 'approved');

CREATE POLICY "Users can contribute ingredients"
  ON ingredients FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX idx_ingredients_status ON ingredients(status);
CREATE INDEX idx_ingredients_name ON ingredients USING gin(to_tsvector('english', name));

-- ─────────────────────────────────────────────────────────
-- dishes (same envelope; read-only to the public)
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dishes (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  data        jsonb NOT NULL,
  status      text DEFAULT 'approved',
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE dishes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read approved dishes"
  ON dishes FOR SELECT
  USING (status = 'approved');

CREATE INDEX idx_dishes_status ON dishes(status);
