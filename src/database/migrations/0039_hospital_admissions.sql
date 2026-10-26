CREATE TABLE "hospital_admission_doctors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"role" text NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hospital_admissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"admitted_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"reason" text,
	"referred_by_id" uuid,
	"corporate_client_id" uuid,
	"staff_id" uuid,
	"admission_fee" numeric(12, 2) NOT NULL,
	"status" text NOT NULL,
	"discharged_at" timestamp with time zone,
	"discharge_type" text,
	"discharge_note" text,
	"cancel_reason" text,
	"admitted_by" uuid,
	"closed_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_admissions_payer_ck" CHECK ("hospital_admissions"."corporate_client_id" is null or "hospital_admissions"."staff_id" is null),
	CONSTRAINT "hospital_admissions_discharge_ck" CHECK (("hospital_admissions"."status" = 'discharged') = ("hospital_admissions"."discharged_at" is not null and "hospital_admissions"."discharge_type" is not null))
);
--> statement-breakpoint
CREATE TABLE "hospital_bed_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"admission_fee" numeric(12, 2) DEFAULT 0 NOT NULL,
	"daily_rate" numeric(12, 2) DEFAULT 0 NOT NULL,
	"is_intensive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_bed_categories_name_ck" CHECK (char_length("hospital_bed_categories"."name") between 1 and 100),
	CONSTRAINT "hospital_bed_categories_amounts_ck" CHECK ("hospital_bed_categories"."admission_fee" >= 0 and "hospital_bed_categories"."daily_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_bed_stays" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"bed_id" uuid NOT NULL,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone,
	"daily_rate" numeric(12, 2) NOT NULL,
	"reason" text,
	"moved_by" uuid,
	CONSTRAINT "hospital_bed_stays_period_ck" CHECK ("hospital_bed_stays"."to_at" is null or "hospital_bed_stays"."to_at" >= "hospital_bed_stays"."from_at")
);
--> statement-breakpoint
CREATE TABLE "hospital_beds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"ward_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"daily_rate" numeric(12, 2),
	"status" text DEFAULT 'available' NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_beds_code_ck" CHECK (char_length("hospital_beds"."code") between 1 and 20),
	CONSTRAINT "hospital_beds_rate_ck" CHECK ("hospital_beds"."daily_rate" is null or "hospital_beds"."daily_rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_wards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"floor" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_wards_name_ck" CHECK (char_length("hospital_wards"."name") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "hospital_patients" ADD COLUMN "corporate_client_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_admission_doctors" ADD CONSTRAINT "hospital_admission_doctors_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_admission_doctors" ADD CONSTRAINT "hospital_admission_doctors_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_admissions" ADD CONSTRAINT "hospital_admissions_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_admissions" ADD CONSTRAINT "hospital_admissions_referred_by_id_hospital_doctors_id_fk" FOREIGN KEY ("referred_by_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_admissions" ADD CONSTRAINT "hospital_admissions_corporate_client_id_hospital_corporate_clients_id_fk" FOREIGN KEY ("corporate_client_id") REFERENCES "public"."hospital_corporate_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_admissions" ADD CONSTRAINT "hospital_admissions_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_admissions" ADD CONSTRAINT "hospital_admissions_admitted_by_users_id_fk" FOREIGN KEY ("admitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_admissions" ADD CONSTRAINT "hospital_admissions_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_bed_stays" ADD CONSTRAINT "hospital_bed_stays_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_bed_stays" ADD CONSTRAINT "hospital_bed_stays_bed_id_hospital_beds_id_fk" FOREIGN KEY ("bed_id") REFERENCES "public"."hospital_beds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_bed_stays" ADD CONSTRAINT "hospital_bed_stays_moved_by_users_id_fk" FOREIGN KEY ("moved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_beds" ADD CONSTRAINT "hospital_beds_ward_id_hospital_wards_id_fk" FOREIGN KEY ("ward_id") REFERENCES "public"."hospital_wards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_beds" ADD CONSTRAINT "hospital_beds_category_id_hospital_bed_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."hospital_bed_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_admission_doctors_primary_uq" ON "hospital_admission_doctors" USING btree ("admission_id") WHERE "hospital_admission_doctors"."role" = 'primary' and "hospital_admission_doctors"."to_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_admission_doctors_current_uq" ON "hospital_admission_doctors" USING btree ("admission_id","doctor_id") WHERE "hospital_admission_doctors"."to_at" is null;--> statement-breakpoint
CREATE INDEX "hospital_admission_doctors_doctor_idx" ON "hospital_admission_doctors" USING btree ("doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_admissions_number_uq" ON "hospital_admissions" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_admissions_active_uq" ON "hospital_admissions" USING btree ("patient_id") WHERE "hospital_admissions"."status" = 'admitted';--> statement-breakpoint
CREATE INDEX "hospital_admissions_admitted_idx" ON "hospital_admissions" USING btree ("admitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_bed_categories_name_uq" ON "hospital_bed_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_bed_stays_bed_uq" ON "hospital_bed_stays" USING btree ("bed_id") WHERE "hospital_bed_stays"."to_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_bed_stays_admission_uq" ON "hospital_bed_stays" USING btree ("admission_id") WHERE "hospital_bed_stays"."to_at" is null;--> statement-breakpoint
CREATE INDEX "hospital_bed_stays_admission_idx" ON "hospital_bed_stays" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_beds_code_uq" ON "hospital_beds" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "hospital_beds_ward_idx" ON "hospital_beds" USING btree ("ward_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_wards_name_uq" ON "hospital_wards" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "hospital_patients" ADD CONSTRAINT "hospital_patients_corporate_client_id_hospital_corporate_clients_id_fk" FOREIGN KEY ("corporate_client_id") REFERENCES "public"."hospital_corporate_clients"("id") ON DELETE restrict ON UPDATE no action;