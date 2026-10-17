CREATE TABLE "bed_spaces" (
	"week" integer NOT NULL,
	"hall" text NOT NULL,
	"slot" integer NOT NULL,
	"account_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bed_spaces_week_hall_slot_pk" PRIMARY KEY("week","hall","slot")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bed_spaces_week_account_unique" ON "bed_spaces" USING btree ("week","account_id");