CREATE TYPE "public"."assign_mode" AS ENUM('opened', 'claimed', 'auto', 'manager');--> statement-breakpoint
CREATE TABLE "table_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"mode" "assign_mode" NOT NULL,
	"assigned_by" uuid,
	"wait_seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "ready_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "served_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "prepared_by" uuid;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "served_by" uuid;--> statement-breakpoint
ALTER TABLE "service_calls" ADD COLUMN "done_by" uuid;--> statement-breakpoint
ALTER TABLE "service_calls" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "assigned_to" uuid;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "assigned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD COLUMN "assign_mode" "assign_mode";--> statement-breakpoint
ALTER TABLE "table_assignments" ADD CONSTRAINT "table_assignments_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_assignments" ADD CONSTRAINT "table_assignments_session_id_table_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."table_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_assignments" ADD CONSTRAINT "table_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_assignments" ADD CONSTRAINT "table_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "table_assignments_venue_idx" ON "table_assignments" USING btree ("venue_id","created_at");--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_prepared_by_users_id_fk" FOREIGN KEY ("prepared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_served_by_users_id_fk" FOREIGN KEY ("served_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_calls" ADD CONSTRAINT "service_calls_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "table_sessions" ADD CONSTRAINT "table_sessions_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;