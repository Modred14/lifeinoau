CREATE TABLE "school_transport" (
	"school_id" text PRIMARY KEY NOT NULL,
	"modes" text[],
	"fares" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "phone" text;