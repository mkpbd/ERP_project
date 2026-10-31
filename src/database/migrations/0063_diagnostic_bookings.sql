CREATE TABLE "hospital_home_collection_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"charge" numeric(12, 2) NOT NULL,
	"minimum_order" numeric(12, 2) DEFAULT 0 NOT NULL,
	"days" text[] DEFAULT '{}'::text[] NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_home_collection_areas_name_ck" CHECK (char_length("hospital_home_collection_areas"."name") between 1 and 100),
	CONSTRAINT "hospital_home_collection_areas_money_ck" CHECK ("hospital_home_collection_areas"."charge" >= 0 and "hospital_home_collection_areas"."minimum_order" >= 0),
	CONSTRAINT "hospital_home_collection_areas_days_ck" CHECK ("hospital_home_collection_areas"."days" <@ array['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']::text[])
);
--> statement-breakpoint
CREATE TABLE "hospital_home_collection_tests" (
	"home_collection_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"test_id" uuid NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	CONSTRAINT "hospital_home_collection_tests_home_collection_id_position_pk" PRIMARY KEY("home_collection_id","position"),
	CONSTRAINT "hospital_home_collection_tests_rate_ck" CHECK ("hospital_home_collection_tests"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_home_collection_windows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_home_collection_windows_label_ck" CHECK (char_length("hospital_home_collection_windows"."label") between 1 and 60),
	CONSTRAINT "hospital_home_collection_windows_order_ck" CHECK ("hospital_home_collection_windows"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_home_collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"patient_id" uuid,
	"patient_name" text NOT NULL,
	"mobile_no" text NOT NULL,
	"area_id" uuid NOT NULL,
	"address" text NOT NULL,
	"landmark" text,
	"collection_date" date NOT NULL,
	"window_id" uuid NOT NULL,
	"window_label" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"charge" numeric(12, 2) NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"collector_id" uuid,
	"assigned_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"collected_by" uuid,
	"collection_note" text,
	"bill_id" uuid,
	"patient_note" text,
	"booked_via" text NOT NULL,
	"booked_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_home_collections_mobile_ck" CHECK ("hospital_home_collections"."mobile_no" ~ '^01[3-9][0-9]{8}$'),
	CONSTRAINT "hospital_home_collections_money_ck" CHECK ("hospital_home_collections"."amount" >= 0 and "hospital_home_collections"."charge" >= 0),
	CONSTRAINT "hospital_home_collections_collector_ck" CHECK (("hospital_home_collections"."status" in ('booked', 'cancelled') or "hospital_home_collections"."collector_id" is not null)
        and ("hospital_home_collections"."status" <> 'collected' or "hospital_home_collections"."collected_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "hospital_test_appointment_tests" (
	"appointment_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"test_id" uuid NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	CONSTRAINT "hospital_test_appointment_tests_appointment_id_position_pk" PRIMARY KEY("appointment_id","position"),
	CONSTRAINT "hospital_test_appointment_tests_rate_ck" CHECK ("hospital_test_appointment_tests"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_test_appointment_windows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text,
	"capacity" smallint NOT NULL,
	"department_id" uuid,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_test_appointment_windows_label_ck" CHECK (char_length("hospital_test_appointment_windows"."label") between 1 and 60),
	CONSTRAINT "hospital_test_appointment_windows_time_ck" CHECK ("hospital_test_appointment_windows"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ("hospital_test_appointment_windows"."end_time" is null or ("hospital_test_appointment_windows"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "hospital_test_appointment_windows"."end_time" > "hospital_test_appointment_windows"."start_time"))),
	CONSTRAINT "hospital_test_appointment_windows_capacity_ck" CHECK ("hospital_test_appointment_windows"."capacity" between 1 and 999),
	CONSTRAINT "hospital_test_appointment_windows_order_ck" CHECK ("hospital_test_appointment_windows"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "hospital_test_appointments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"patient_id" uuid,
	"patient_name" text NOT NULL,
	"mobile_no" text NOT NULL,
	"appointment_date" date NOT NULL,
	"window_id" uuid NOT NULL,
	"window_label" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text,
	"serial" smallint NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"bill_id" uuid,
	"remarks" text,
	"booked_via" text NOT NULL,
	"booked_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_test_appointments_serial_ck" CHECK ("hospital_test_appointments"."serial" between 1 and 999),
	CONSTRAINT "hospital_test_appointments_mobile_ck" CHECK ("hospital_test_appointments"."mobile_no" ~ '^01[3-9][0-9]{8}$'),
	CONSTRAINT "hospital_test_appointments_amount_ck" CHECK ("hospital_test_appointments"."amount" >= 0),
	CONSTRAINT "hospital_test_appointments_billed_ck" CHECK (("hospital_test_appointments"."status" = 'billed') = ("hospital_test_appointments"."bill_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_policy" ADD COLUMN "home_collection_test_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_home_collection_tests" ADD CONSTRAINT "hospital_home_collection_tests_home_collection_id_hospital_home_collections_id_fk" FOREIGN KEY ("home_collection_id") REFERENCES "public"."hospital_home_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_home_collection_tests" ADD CONSTRAINT "hospital_home_collection_tests_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_home_collections" ADD CONSTRAINT "hospital_home_collections_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_home_collections" ADD CONSTRAINT "hospital_home_collections_area_id_hospital_home_collection_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."hospital_home_collection_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_home_collections" ADD CONSTRAINT "hospital_home_collections_window_id_hospital_home_collection_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."hospital_home_collection_windows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_home_collections" ADD CONSTRAINT "hospital_home_collections_collector_id_users_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_home_collections" ADD CONSTRAINT "hospital_home_collections_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_home_collections" ADD CONSTRAINT "hospital_home_collections_bill_id_hospital_diagnostic_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_diagnostic_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_home_collections" ADD CONSTRAINT "hospital_home_collections_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_test_appointment_tests" ADD CONSTRAINT "hospital_test_appointment_tests_appointment_id_hospital_test_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."hospital_test_appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_test_appointment_tests" ADD CONSTRAINT "hospital_test_appointment_tests_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_test_appointment_windows" ADD CONSTRAINT "hospital_test_appointment_windows_department_id_hospital_diagnostic_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hospital_diagnostic_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_test_appointments" ADD CONSTRAINT "hospital_test_appointments_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_test_appointments" ADD CONSTRAINT "hospital_test_appointments_window_id_hospital_test_appointment_windows_id_fk" FOREIGN KEY ("window_id") REFERENCES "public"."hospital_test_appointment_windows"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_test_appointments" ADD CONSTRAINT "hospital_test_appointments_bill_id_hospital_diagnostic_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_diagnostic_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_test_appointments" ADD CONSTRAINT "hospital_test_appointments_booked_by_users_id_fk" FOREIGN KEY ("booked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_home_collection_areas_name_uq" ON "hospital_home_collection_areas" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_home_collection_tests_test_uq" ON "hospital_home_collection_tests" USING btree ("home_collection_id","test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_home_collection_windows_label_uq" ON "hospital_home_collection_windows" USING btree (lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_home_collections_number_uq" ON "hospital_home_collections" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_home_collections_bill_uq" ON "hospital_home_collections" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "hospital_home_collections_date_idx" ON "hospital_home_collections" USING btree ("collection_date");--> statement-breakpoint
CREATE INDEX "hospital_home_collections_patient_idx" ON "hospital_home_collections" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "hospital_home_collections_collector_idx" ON "hospital_home_collections" USING btree ("collector_id","collection_date");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_test_appointment_tests_test_uq" ON "hospital_test_appointment_tests" USING btree ("appointment_id","test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_test_appointment_windows_label_uq" ON "hospital_test_appointment_windows" USING btree (lower("label"),coalesce("department_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_test_appointments_number_uq" ON "hospital_test_appointments" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_test_appointments_serial_uq" ON "hospital_test_appointments" USING btree ("window_id","appointment_date","serial") WHERE "hospital_test_appointments"."status" <> 'cancelled';--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_test_appointments_bill_uq" ON "hospital_test_appointments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "hospital_test_appointments_date_idx" ON "hospital_test_appointments" USING btree ("appointment_date");--> statement-breakpoint
CREATE INDEX "hospital_test_appointments_patient_idx" ON "hospital_test_appointments" USING btree ("patient_id");--> statement-breakpoint
ALTER TABLE "hospital_diagnostic_policy" ADD CONSTRAINT "hospital_diagnostic_policy_home_collection_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("home_collection_test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;