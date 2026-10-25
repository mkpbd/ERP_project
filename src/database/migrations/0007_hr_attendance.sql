CREATE TABLE "attendance_punches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"biometric_no" integer NOT NULL,
	"staff_id" uuid,
	"machine_no" integer DEFAULT 0 NOT NULL,
	"punched_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"received_by" uuid
);
--> statement-breakpoint
CREATE TABLE "manual_attendances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"in_time" time,
	"out_time" time,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"created_by" uuid,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_remarks" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_attendances_status_ck" CHECK ("manual_attendances"."status" in ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "manual_attendances_times_ck" CHECK ("manual_attendances"."in_time" is not null or "manual_attendances"."out_time" is not null),
	CONSTRAINT "manual_attendances_order_ck" CHECK ("manual_attendances"."in_time" is null or "manual_attendances"."out_time" is null or "manual_attendances"."out_time" > "manual_attendances"."in_time")
);
--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_attendances" ADD CONSTRAINT "manual_attendances_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_attendances" ADD CONSTRAINT "manual_attendances_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_attendances" ADD CONSTRAINT "manual_attendances_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_attendances" ADD CONSTRAINT "manual_attendances_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_punches_unique_uq" ON "attendance_punches" USING btree ("biometric_no","punched_at");--> statement-breakpoint
CREATE INDEX "attendance_punches_staff_idx" ON "attendance_punches" USING btree ("staff_id","punched_at");--> statement-breakpoint
CREATE INDEX "attendance_punches_unmatched_idx" ON "attendance_punches" USING btree ("biometric_no","punched_at") WHERE "attendance_punches"."staff_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "manual_attendances_live_uq" ON "manual_attendances" USING btree ("staff_id","attendance_date") WHERE "manual_attendances"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "manual_attendances_status_idx" ON "manual_attendances" USING btree ("status","attendance_date");