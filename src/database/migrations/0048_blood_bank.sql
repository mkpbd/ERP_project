CREATE TABLE "blood_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"request_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"admission_id" uuid,
	"issued_on" date NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"voucher_number" text,
	"issued_by" uuid
);
--> statement-breakpoint
CREATE TABLE "blood_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"patient_id" uuid NOT NULL,
	"admission_id" uuid,
	"bill_id" uuid,
	"component_type_id" uuid NOT NULL,
	"units" smallint NOT NULL,
	"blood_group" text NOT NULL,
	"reason" text,
	"requested_on" date NOT NULL,
	"status" text NOT NULL,
	"requested_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blood_requests_units_ck" CHECK ("blood_requests"."units" between 1 and 20),
	CONSTRAINT "blood_requests_payer_ck" CHECK (("blood_requests"."admission_id" is null) <> ("blood_requests"."bill_id" is null))
);
--> statement-breakpoint
CREATE TABLE "blood_sequences" (
	"kind" text NOT NULL,
	"year" smallint NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "blood_sequences_kind_year_pk" PRIMARY KEY("kind","year")
);
--> statement-breakpoint
CREATE TABLE "blood_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_number" text NOT NULL,
	"donation_id" uuid NOT NULL,
	"component_type_id" uuid NOT NULL,
	"blood_group" text NOT NULL,
	"prepared_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"status" text NOT NULL,
	"request_id" uuid,
	"discard_reason" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blood_component_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"shelf_days" smallint NOT NULL,
	"compatibility" text NOT NULL,
	"rate" numeric(12, 2) DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blood_component_types_ck" CHECK ("blood_component_types"."shelf_days" between 1 and 3650 and "blood_component_types"."rate" >= 0)
);
--> statement-breakpoint
CREATE TABLE "blood_crossmatches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"result" text NOT NULL,
	"method" text,
	"done_by" uuid,
	"done_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blood_donations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bag_number" text NOT NULL,
	"donor_id" uuid NOT NULL,
	"donated_on" date NOT NULL,
	"donated_at" timestamp with time zone NOT NULL,
	"blood_group" text NOT NULL,
	"volume_ml" smallint NOT NULL,
	"status" text NOT NULL,
	"hiv" text,
	"hbsag" text,
	"hcv" text,
	"syphilis" text,
	"malaria" text,
	"screened_by" uuid,
	"screened_at" timestamp with time zone,
	"discard_reason" text,
	"collected_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blood_donations_volume_ck" CHECK ("blood_donations"."volume_ml" between 50 and 600)
);
--> statement-breakpoint
CREATE TABLE "blood_donors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"full_name" text NOT NULL,
	"sex" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"blood_group" text NOT NULL,
	"mobile_no" text,
	"address" text,
	"last_donated_on" date,
	"deferred_until" date,
	"defer_reason" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_request_id_blood_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."blood_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_unit_id_blood_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."blood_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_issues" ADD CONSTRAINT "blood_issues_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_bill_id_hospital_diagnostic_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_diagnostic_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_component_type_id_blood_component_types_id_fk" FOREIGN KEY ("component_type_id") REFERENCES "public"."blood_component_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_requests" ADD CONSTRAINT "blood_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_units" ADD CONSTRAINT "blood_units_donation_id_blood_donations_id_fk" FOREIGN KEY ("donation_id") REFERENCES "public"."blood_donations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_units" ADD CONSTRAINT "blood_units_component_type_id_blood_component_types_id_fk" FOREIGN KEY ("component_type_id") REFERENCES "public"."blood_component_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_crossmatches" ADD CONSTRAINT "blood_crossmatches_request_id_blood_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."blood_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_crossmatches" ADD CONSTRAINT "blood_crossmatches_unit_id_blood_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."blood_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_crossmatches" ADD CONSTRAINT "blood_crossmatches_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_donations" ADD CONSTRAINT "blood_donations_donor_id_blood_donors_id_fk" FOREIGN KEY ("donor_id") REFERENCES "public"."blood_donors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_donations" ADD CONSTRAINT "blood_donations_screened_by_users_id_fk" FOREIGN KEY ("screened_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blood_donations" ADD CONSTRAINT "blood_donations_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "blood_issues_number_uq" ON "blood_issues" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "blood_issues_unit_uq" ON "blood_issues" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "blood_issues_admission_idx" ON "blood_issues" USING btree ("admission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blood_requests_number_uq" ON "blood_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "blood_requests_patient_idx" ON "blood_requests" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blood_units_number_uq" ON "blood_units" USING btree ("unit_number");--> statement-breakpoint
CREATE UNIQUE INDEX "blood_units_component_uq" ON "blood_units" USING btree ("donation_id","component_type_id");--> statement-breakpoint
CREATE INDEX "blood_units_stock_idx" ON "blood_units" USING btree ("status","blood_group","component_type_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blood_component_types_name_uq" ON "blood_component_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "blood_component_types_code_uq" ON "blood_component_types" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "blood_crossmatches_request_idx" ON "blood_crossmatches" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blood_donations_bag_uq" ON "blood_donations" USING btree ("bag_number");--> statement-breakpoint
CREATE INDEX "blood_donations_donor_idx" ON "blood_donations" USING btree ("donor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "blood_donors_number_uq" ON "blood_donors" USING btree ("number");--> statement-breakpoint
CREATE INDEX "blood_donors_name_idx" ON "blood_donors" USING btree (lower("full_name"));--> statement-breakpoint
CREATE INDEX "blood_donors_mobile_idx" ON "blood_donors" USING btree ("mobile_no");