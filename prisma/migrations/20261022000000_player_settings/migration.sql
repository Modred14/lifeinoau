-- A player's saved preferences (audio, gameplay, notifications, privacy, accessibility). Null means "all defaults", so every existing player keeps working untouched.
ALTER TABLE "Character" ADD COLUMN IF NOT EXISTS "settings" JSONB;
