CREATE TABLE "politics_campus_states" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"issue" text DEFAULT '' NOT NULL,
	"starts_at" integer NOT NULL,
	"ends_at" integer NOT NULL,
	"concession" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "politics_congress_sides" (
	"sitting" text NOT NULL,
	"account_id" char(64) NOT NULL,
	"side" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politics_congress_sides_sitting_account_pk" PRIMARY KEY("sitting","account_id")
);
--> statement-breakpoint
CREATE TABLE "politics_impeachments" (
	"cycle" integer NOT NULL,
	"race" text NOT NULL,
	"ousted" text DEFAULT '' NOT NULL,
	"successor" text DEFAULT '' NOT NULL,
	"successor_account" char(64),
	"removed" boolean DEFAULT false NOT NULL,
	"at" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politics_impeachments_cycle_race_pk" PRIMARY KEY("cycle","race")
);
--> statement-breakpoint
CREATE TABLE "politics_rentals" (
	"cycle" integer NOT NULL,
	"area" text NOT NULL,
	"slot" integer NOT NULL,
	"candidacy_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politics_rentals_cycle_area_slot_pk" PRIMARY KEY("cycle","area","slot")
);
--> statement-breakpoint
CREATE TABLE "politics_reruns" (
	"cycle" integer NOT NULL,
	"race" text NOT NULL,
	"by" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politics_reruns_cycle_race_pk" PRIMARY KEY("cycle","race")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "admin" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "conditions" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "social" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "politics_candidacies" ADD COLUMN "nick" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "politics_candidacies" ADD COLUMN "slogan" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "politics_candidacies" ADD COLUMN "color" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "politics_candidacies" ADD COLUMN "stops" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "politics_campus_states_ends_idx" ON "politics_campus_states" USING btree ("ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "politics_rentals_cycle_area_candidacy_unique" ON "politics_rentals" USING btree ("cycle","area","candidacy_id");