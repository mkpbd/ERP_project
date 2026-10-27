CREATE TABLE "lab_reagent_uses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"test_id" uuid NOT NULL,
	"store_department_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	"used_on" date NOT NULL,
	"consumption_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_stock_departments" (
	"diagnostic_department_id" uuid PRIMARY KEY NOT NULL,
	"store_department_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_test_reagents" (
	"test_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(12, 3) NOT NULL,
	CONSTRAINT "lab_test_reagents_test_id_variant_id_pk" PRIMARY KEY("test_id","variant_id"),
	CONSTRAINT "lab_test_reagents_qty_ck" CHECK ("lab_test_reagents"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "lab_imaging_studies" ADD COLUMN "reagents" text;--> statement-breakpoint
ALTER TABLE "lab_results" ADD COLUMN "reagents" text;--> statement-breakpoint
ALTER TABLE "lab_reagent_uses" ADD CONSTRAINT "lab_reagent_uses_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_reagent_uses" ADD CONSTRAINT "lab_reagent_uses_store_department_id_store_departments_id_fk" FOREIGN KEY ("store_department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_reagent_uses" ADD CONSTRAINT "lab_reagent_uses_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_stock_departments" ADD CONSTRAINT "lab_stock_departments_diagnostic_department_id_hospital_diagnostic_departments_id_fk" FOREIGN KEY ("diagnostic_department_id") REFERENCES "public"."hospital_diagnostic_departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_stock_departments" ADD CONSTRAINT "lab_stock_departments_store_department_id_store_departments_id_fk" FOREIGN KEY ("store_department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_reagents" ADD CONSTRAINT "lab_test_reagents_test_id_hospital_diagnostic_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."hospital_diagnostic_tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_test_reagents" ADD CONSTRAINT "lab_test_reagents_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lab_reagent_uses_source_idx" ON "lab_reagent_uses" USING btree ("source_kind","source_id");--> statement-breakpoint
CREATE INDEX "lab_reagent_uses_used_idx" ON "lab_reagent_uses" USING btree ("used_on");