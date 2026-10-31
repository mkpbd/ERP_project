CREATE TABLE "lab_antibiotics" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"group_name" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_antibiotics_name_ck" CHECK (char_length("lab_antibiotics"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "lab_culture_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_culture_messages_text_ck" CHECK (char_length("lab_culture_messages"."text") between 1 and 500)
);
--> statement-breakpoint
CREATE TABLE "lab_culture_organisms" (
	"result_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"organism_id" uuid,
	"name" text NOT NULL,
	CONSTRAINT "lab_culture_organisms_result_id_position_pk" PRIMARY KEY("result_id","position"),
	CONSTRAINT "lab_culture_organisms_position_ck" CHECK ("lab_culture_organisms"."position" between 1 and 3)
);
--> statement-breakpoint
CREATE TABLE "lab_culture_reports" (
	"result_id" uuid PRIMARY KEY NOT NULL,
	"analyzer" text,
	"pus_cells" text,
	"epithelial_cells" text,
	"rbc" text,
	"microscopy_note" text,
	"growth" boolean NOT NULL,
	"growth_type_id" uuid,
	"growth_type" text,
	"colony_count" text,
	"incubation" text,
	"media" text,
	"message" text
);
--> statement-breakpoint
CREATE TABLE "lab_culture_sensitivities" (
	"result_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"antibiotic_id" uuid,
	"antibiotic" text NOT NULL,
	"zone" text,
	"result_1" text,
	"result_2" text,
	"result_3" text,
	CONSTRAINT "lab_culture_sensitivities_result_id_position_pk" PRIMARY KEY("result_id","position"),
	CONSTRAINT "lab_culture_sensitivities_results_ck" CHECK (coalesce("lab_culture_sensitivities"."result_1", "lab_culture_sensitivities"."result_2", "lab_culture_sensitivities"."result_3") is not null)
);
--> statement-breakpoint
CREATE TABLE "lab_growth_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_growth_types_name_ck" CHECK (char_length("lab_growth_types"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "lab_organisms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_organisms_name_ck" CHECK (char_length("lab_organisms"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "lab_report_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_report_templates_name_ck" CHECK (char_length("lab_report_templates"."name") between 1 and 150),
	CONSTRAINT "lab_report_templates_body_ck" CHECK (char_length("lab_report_templates"."body") between 1 and 20000)
);
--> statement-breakpoint
CREATE TABLE "lab_test_forms" (
	"test_id" uuid PRIMARY KEY NOT NULL,
	"form" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lab_test_forms_form_ck" CHECK ("lab_test_forms"."form" <> 'values')
);
--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "form" text;--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "narrative" text;--> statement-breakpoint
ALTER TABLE "lab_culture_organisms" ADD CONSTRAINT "lab_culture_organisms_result_id_lab_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."lab_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_culture_organisms" ADD CONSTRAINT "lab_culture_organisms_organism_id_lab_organisms_id_fk" FOREIGN KEY ("organism_id") REFERENCES "public"."lab_organisms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_culture_reports" ADD CONSTRAINT "lab_culture_reports_result_id_lab_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."lab_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_culture_reports" ADD CONSTRAINT "lab_culture_reports_growth_type_id_lab_growth_types_id_fk" FOREIGN KEY ("growth_type_id") REFERENCES "public"."lab_growth_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_culture_sensitivities" ADD CONSTRAINT "lab_culture_sensitivities_result_id_lab_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."lab_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_culture_sensitivities" ADD CONSTRAINT "lab_culture_sensitivities_antibiotic_id_lab_antibiotics_id_fk" FOREIGN KEY ("antibiotic_id") REFERENCES "public"."lab_antibiotics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_forms" ADD CONSTRAINT "lab_test_forms_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lab_antibiotics_name_uq" ON "lab_antibiotics" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_culture_messages_text_uq" ON "lab_culture_messages" USING btree ("text");--> statement-breakpoint
CREATE INDEX "lab_culture_organisms_organism_idx" ON "lab_culture_organisms" USING btree ("organism_id");--> statement-breakpoint
CREATE INDEX "lab_culture_sensitivities_antibiotic_idx" ON "lab_culture_sensitivities" USING btree ("antibiotic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_growth_types_name_uq" ON "lab_growth_types" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_organisms_name_uq" ON "lab_organisms" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "lab_report_templates_name_uq" ON "lab_report_templates" USING btree ("name");--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_narrative_ck" CHECK (("lab_results"."narrative" is null) = ("lab_results"."form" is distinct from 'descriptive'));--> statement-breakpoint
-- Results entered before this step were entered as values.
UPDATE "lab_results" SET "form" = 'values' WHERE "entered_at" IS NOT NULL;
