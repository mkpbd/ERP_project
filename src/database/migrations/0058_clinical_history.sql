CREATE TABLE "clinical_history_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"number" text,
	"recorded_on" date NOT NULL,
	"author" text,
	"body" text NOT NULL,
	"shared" boolean NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinical_history_records_kind_ck" CHECK ("clinical_history_records"."kind" in ('prescription', 'lab-report', 'imaging-report', 'discharge-summary', 'note')),
	CONSTRAINT "clinical_history_records_title_ck" CHECK (char_length("clinical_history_records"."title") between 1 and 200),
	CONSTRAINT "clinical_history_records_body_ck" CHECK (char_length("clinical_history_records"."body") <= 200000)
);
--> statement-breakpoint
CREATE TABLE "clinical_history_values" (
	"record_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"test" text NOT NULL,
	"result" text NOT NULL,
	"unit" text,
	"reference" text,
	CONSTRAINT "clinical_history_values_record_id_position_pk" PRIMARY KEY("record_id","position"),
	CONSTRAINT "clinical_history_values_test_ck" CHECK (char_length("clinical_history_values"."test") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "clinical_history_records" ADD CONSTRAINT "clinical_history_records_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_history_values" ADD CONSTRAINT "clinical_history_values_record_id_clinical_history_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."clinical_history_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clinical_history_records_source_uq" ON "clinical_history_records" USING btree ("source");--> statement-breakpoint
CREATE INDEX "clinical_history_records_patient_idx" ON "clinical_history_records" USING btree ("patient_id","recorded_on");--> statement-breakpoint
CREATE INDEX "clinical_history_values_test_idx" ON "clinical_history_values" USING btree (lower("test"));