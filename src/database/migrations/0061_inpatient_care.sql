CREATE TABLE "clinical_observation_rounds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_observation_rounds_times_ck" CHECK ("clinical_observation_rounds"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "clinical_observation_rounds"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "clinical_observation_rounds"."start_time" <> "clinical_observation_rounds"."end_time")
);
--> statement-breakpoint
CREATE TABLE "clinical_observations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"taken_at" timestamp with time zone NOT NULL,
	"round_id" uuid,
	"round_on" date,
	"temperature_f" numeric(5, 1),
	"pulse" smallint,
	"resp_rate" smallint,
	"systolic" smallint,
	"diastolic" smallint,
	"spo2" smallint,
	"pain_score" smallint,
	"blood_sugar" numeric(5, 1),
	"intake_ml" integer,
	"output_ml" integer,
	"consciousness" text,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"struck_at" timestamp with time zone,
	"struck_by" uuid,
	"struck_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_observations_round_ck" CHECK (("clinical_observations"."round_id" is null) = ("clinical_observations"."round_on" is null)),
	CONSTRAINT "clinical_observations_struck_ck" CHECK (("clinical_observations"."struck_at" is null) = ("clinical_observations"."struck_reason" is null))
);
--> statement-breakpoint
CREATE TABLE "hospital_visitor_passes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"admission_id" uuid NOT NULL,
	"visitor_name" text NOT NULL,
	"relation" text,
	"mobile_no" text,
	"status" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_by" uuid,
	"returned_at" timestamp with time zone,
	"returned_by" uuid,
	CONSTRAINT "hospital_visitor_passes_returned_ck" CHECK (("hospital_visitor_passes"."status" = 'returned') = ("hospital_visitor_passes"."returned_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "clinical_treatment_orders" ALTER COLUMN "dose" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clinical_treatment_orders" ALTER COLUMN "route" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "clinical_treatment_orders" ADD COLUMN "kind" text DEFAULT 'medicine' NOT NULL;--> statement-breakpoint
ALTER TABLE "hospital_ipd_policy" ADD COLUMN "visitor_pass_limit" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "clinical_observations" ADD CONSTRAINT "clinical_observations_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_observations" ADD CONSTRAINT "clinical_observations_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_observations" ADD CONSTRAINT "clinical_observations_round_id_clinical_observation_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."clinical_observation_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_observations" ADD CONSTRAINT "clinical_observations_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_observations" ADD CONSTRAINT "clinical_observations_struck_by_users_id_fk" FOREIGN KEY ("struck_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_visitor_passes" ADD CONSTRAINT "hospital_visitor_passes_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_visitor_passes" ADD CONSTRAINT "hospital_visitor_passes_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_visitor_passes" ADD CONSTRAINT "hospital_visitor_passes_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_observation_rounds_name_uq" ON "clinical_observation_rounds" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "clinical_observations_admission_idx" ON "clinical_observations" USING btree ("admission_id","taken_at");--> statement-breakpoint
CREATE INDEX "clinical_observations_round_idx" ON "clinical_observations" USING btree ("round_on","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_visitor_passes_number_uq" ON "hospital_visitor_passes" USING btree ("number");--> statement-breakpoint
CREATE INDEX "hospital_visitor_passes_admission_idx" ON "hospital_visitor_passes" USING btree ("admission_id","status");--> statement-breakpoint
ALTER TABLE "clinical_treatment_orders" ADD CONSTRAINT "clinical_treatment_orders_kind_ck" CHECK (("clinical_treatment_orders"."kind" = 'care' and "clinical_treatment_orders"."route" is null and "clinical_treatment_orders"."product_id" is null) or ("clinical_treatment_orders"."kind" = 'medicine' and "clinical_treatment_orders"."dose" is not null and "clinical_treatment_orders"."route" is not null));--> statement-breakpoint
ALTER TABLE "hospital_ipd_policy" ADD CONSTRAINT "hospital_ipd_policy_passes_ck" CHECK ("hospital_ipd_policy"."visitor_pass_limit" between 1 and 10);