CREATE TABLE "job_application_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by" uuid,
	CONSTRAINT "job_application_files_type_ck" CHECK ("job_application_files"."content_type" in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
	CONSTRAINT "job_application_files_size_ck" CHECK (octet_length("job_application_files"."data") between 1 and 5242880)
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circular_id" uuid NOT NULL,
	"applied_for" text,
	"applicant_name" text NOT NULL,
	"mobile_no" text,
	"email" text,
	"status" text DEFAULT 'received' NOT NULL,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_applications_name_len_ck" CHECK (char_length("job_applications"."applicant_name") between 1 and 150),
	CONSTRAINT "job_applications_status_ck" CHECK ("job_applications"."status" in ('received', 'shortlisted', 'interviewed', 'selected', 'rejected', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "job_circulars" (
	"id" uuid PRIMARY KEY NOT NULL,
	"circular_no" text NOT NULL,
	"title" text NOT NULL,
	"department_id" uuid,
	"designation_id" uuid,
	"vacancies" integer,
	"published_on" date,
	"closes_on" date,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_circulars_no_len_ck" CHECK (char_length("job_circulars"."circular_no") between 1 and 50),
	CONSTRAINT "job_circulars_title_len_ck" CHECK (char_length("job_circulars"."title") between 1 and 200),
	CONSTRAINT "job_circulars_vacancies_ck" CHECK ("job_circulars"."vacancies" is null or "job_circulars"."vacancies" between 1 and 10000),
	CONSTRAINT "job_circulars_dates_ck" CHECK ("job_circulars"."closes_on" is null or "job_circulars"."published_on" is null or "job_circulars"."closes_on" >= "job_circulars"."published_on")
);
--> statement-breakpoint
ALTER TABLE "job_application_files" ADD CONSTRAINT "job_application_files_application_id_job_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."job_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_application_files" ADD CONSTRAINT "job_application_files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_circular_id_job_circulars_id_fk" FOREIGN KEY ("circular_id") REFERENCES "public"."job_circulars"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_circulars" ADD CONSTRAINT "job_circulars_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_circulars" ADD CONSTRAINT "job_circulars_designation_id_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."designations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_application_files_application_idx" ON "job_application_files" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "job_applications_circular_idx" ON "job_applications" USING btree ("circular_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_circular_mobile_uq" ON "job_applications" USING btree ("circular_id","mobile_no");--> statement-breakpoint
CREATE UNIQUE INDEX "job_circulars_no_uq" ON "job_circulars" USING btree (upper("circular_no"));