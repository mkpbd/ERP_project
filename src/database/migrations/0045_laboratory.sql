CREATE TABLE "lab_parameter_ranges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parameter_id" uuid NOT NULL,
	"sex" text,
	"min_age_days" integer DEFAULT 0 NOT NULL,
	"max_age_days" integer,
	"low" numeric(14, 4),
	"high" numeric(14, 4),
	"normal_text" text,
	CONSTRAINT "lab_parameter_ranges_age_ck" CHECK ("lab_parameter_ranges"."min_age_days" >= 0 and ("lab_parameter_ranges"."max_age_days" is null or "lab_parameter_ranges"."max_age_days" >= "lab_parameter_ranges"."min_age_days")),
	CONSTRAINT "lab_parameter_ranges_values_ck" CHECK ("lab_parameter_ranges"."low" is null or "lab_parameter_ranges"."high" is null or "lab_parameter_ranges"."low" <= "lab_parameter_ranges"."high")
);
--> statement-breakpoint
CREATE TABLE "lab_parameters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"test_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"name" text NOT NULL,
	"unit" text,
	"method" text,
	"kind" text NOT NULL,
	"decimals" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_parameters_name_ck" CHECK (char_length("lab_parameters"."name") between 1 and 100),
	CONSTRAINT "lab_parameters_decimals_ck" CHECK ("lab_parameters"."decimals" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "lab_result_values" (
	"result_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"parameter_id" uuid,
	"name" text NOT NULL,
	"unit" text,
	"method" text,
	"value" text,
	"numeric" numeric(14, 4),
	"low" numeric(14, 4),
	"high" numeric(14, 4),
	"normal_text" text,
	"flag" text,
	CONSTRAINT "lab_result_values_result_id_position_pk" PRIMARY KEY("result_id","position")
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sample_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"line" smallint NOT NULL,
	"test_id" uuid NOT NULL,
	"status" text NOT NULL,
	"comment" text,
	"entered_by" uuid,
	"entered_at" timestamp with time zone,
	"verified_by" uuid,
	"verified_at" timestamp with time zone,
	"delivered_to" text,
	"delivered_by" uuid,
	"delivered_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_samples" (
	"id" uuid PRIMARY KEY NOT NULL,
	"lab_number" text NOT NULL,
	"bill_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"collected_on" date NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"collected_by" uuid,
	"status" text NOT NULL,
	"received_at" timestamp with time zone,
	"received_by" uuid,
	"reject_reason" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_sequences" (
	"day" date PRIMARY KEY NOT NULL,
	"last" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lab_parameter_ranges" ADD CONSTRAINT "lab_parameter_ranges_parameter_id_lab_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."lab_parameters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_parameters" ADD CONSTRAINT "lab_parameters_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_result_values" ADD CONSTRAINT "lab_result_values_result_id_lab_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."lab_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_result_values" ADD CONSTRAINT "lab_result_values_parameter_id_lab_parameters_id_fk" FOREIGN KEY ("parameter_id") REFERENCES "public"."lab_parameters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_sample_id_lab_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."lab_samples"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_bill_id_hospital_diagnostic_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_diagnostic_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_delivered_by_users_id_fk" FOREIGN KEY ("delivered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_bill_id_hospital_diagnostic_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."hospital_diagnostic_bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_department_id_hospital_diagnostic_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hospital_diagnostic_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_collected_by_users_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_received_by_users_id_fk" FOREIGN KEY ("received_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_parameter_ranges_parameter_idx" ON "lab_parameter_ranges" USING btree ("parameter_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_parameters_position_uq" ON "lab_parameters" USING btree ("test_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_results_line_uq" ON "lab_results" USING btree ("bill_id","line") WHERE "lab_results"."status" <> 'rejected';--> statement-breakpoint
CREATE INDEX "lab_results_sample_idx" ON "lab_results" USING btree ("sample_id");--> statement-breakpoint
CREATE INDEX "lab_results_status_idx" ON "lab_results" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_samples_number_uq" ON "lab_samples" USING btree ("lab_number");--> statement-breakpoint
CREATE INDEX "lab_samples_bill_idx" ON "lab_samples" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "lab_samples_collected_idx" ON "lab_samples" USING btree ("collected_on","department_id");