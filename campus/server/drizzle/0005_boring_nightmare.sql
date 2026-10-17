CREATE TABLE "politics_candidacies" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" char(64) NOT NULL,
	"cycle" integer NOT NULL,
	"race" text NOT NULL,
	"name" text NOT NULL,
	"support" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"materials" text[] DEFAULT '{}'::text[] NOT NULL,
	"spoke" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "politics_endorsements" (
	"account_id" char(64) NOT NULL,
	"cycle" integer NOT NULL,
	"race" text NOT NULL,
	"candidate" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politics_endorsements_account_cycle_pk" PRIMARY KEY("account_id","cycle")
);
--> statement-breakpoint
CREATE TABLE "politics_marks" (
	"account_id" char(64) NOT NULL,
	"cycle" integer NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politics_marks_account_cycle_kind_pk" PRIMARY KEY("account_id","cycle","kind")
);
--> statement-breakpoint
CREATE TABLE "politics_offices" (
	"cycle" integer NOT NULL,
	"race" text NOT NULL,
	"account_id" char(64) NOT NULL,
	"name" text NOT NULL,
	"stipend" integer DEFAULT 0 NOT NULL,
	"stipend_paid" boolean DEFAULT false NOT NULL,
	"power_used_at" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politics_offices_cycle_race_pk" PRIMARY KEY("cycle","race")
);
--> statement-breakpoint
CREATE TABLE "politics_votes" (
	"account_id" char(64) NOT NULL,
	"cycle" integer NOT NULL,
	"race" text NOT NULL,
	"candidate" text NOT NULL,
	"informed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "politics_votes_account_cycle_race_pk" PRIMARY KEY("account_id","cycle","race")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "attendance" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "politics_candidacies_account_cycle_unique" ON "politics_candidacies" USING btree ("account_id","cycle");--> statement-breakpoint
CREATE INDEX "politics_candidacies_cycle_race_idx" ON "politics_candidacies" USING btree ("cycle","race");--> statement-breakpoint
CREATE INDEX "politics_endorsements_cycle_race_idx" ON "politics_endorsements" USING btree ("cycle","race");--> statement-breakpoint
CREATE INDEX "politics_offices_account_idx" ON "politics_offices" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "politics_votes_cycle_race_idx" ON "politics_votes" USING btree ("cycle","race");