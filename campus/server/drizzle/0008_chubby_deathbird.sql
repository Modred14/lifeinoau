CREATE TABLE "market_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"request_id" text NOT NULL,
	"vendor_id" text NOT NULL,
	"request" text NOT NULL,
	"deliver_to" text NOT NULL,
	"deliver_note" text DEFAULT '' NOT NULL,
	"contact_phone" text NOT NULL,
	"status" text NOT NULL,
	"payment_method" text NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"item_cost_kobo" bigint,
	"delivery_fee_kobo" bigint NOT NULL,
	"rider_account_id" text,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "market_orders_request_unique" UNIQUE("account_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"account_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_roles_pk" PRIMARY KEY("account_id","role")
);
--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_orders" ADD CONSTRAINT "market_orders_rider_account_id_accounts_id_fk" FOREIGN KEY ("rider_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_orders_account_idx" ON "market_orders" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "market_orders_status_idx" ON "market_orders" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "market_orders_rider_idx" ON "market_orders" USING btree ("rider_account_id","status");