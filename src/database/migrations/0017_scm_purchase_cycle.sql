CREATE TABLE "comparative_studies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"study_date" date NOT NULL,
	"requisition_id" uuid,
	"title" text NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"current_level" smallint,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comparative_studies_status_ck" CHECK ("comparative_studies"."status" in ('draft', 'pending', 'approved', 'rejected')),
	CONSTRAINT "comparative_studies_level_ck" CHECK (("comparative_studies"."status" = 'pending') = ("comparative_studies"."current_level" is not null))
);
--> statement-breakpoint
CREATE TABLE "comparative_study_approvals" (
	"study_id" uuid NOT NULL,
	"level_order" smallint NOT NULL,
	"level_name" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"remarks" text,
	CONSTRAINT "comparative_study_approvals_study_id_level_order_pk" PRIMARY KEY("study_id","level_order"),
	CONSTRAINT "comparative_study_approvals_decision_ck" CHECK ("comparative_study_approvals"."decision" in ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "comparative_study_quotes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"study_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"supplier_id" uuid NOT NULL,
	"variant_id" uuid,
	"manual_name" text,
	"qty" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"vat_percent" numeric(5, 2) NOT NULL,
	"ait_percent" numeric(5, 2) NOT NULL,
	"vat" numeric(14, 2) NOT NULL,
	"ait" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"selected" boolean NOT NULL,
	CONSTRAINT "comparative_study_quotes_item_ck" CHECK (("comparative_study_quotes"."variant_id" is null) <> ("comparative_study_quotes"."manual_name" is null)),
	CONSTRAINT "comparative_study_quotes_amounts_ck" CHECK ("comparative_study_quotes"."qty" > 0 and "comparative_study_quotes"."unit_price" >= 0 and "comparative_study_quotes"."total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "cs_approval_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"level_order" smallint NOT NULL,
	"name" text NOT NULL,
	"approver_staff_id" uuid NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cs_approval_levels_order_ck" CHECK ("cs_approval_levels"."level_order" between 1 and 20),
	CONSTRAINT "cs_approval_levels_name_len_ck" CHECK (char_length("cs_approval_levels"."name") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "purchase_approval_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"main_store_id" uuid NOT NULL,
	"level_order" smallint NOT NULL,
	"name" text NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_approval_levels_order_ck" CHECK ("purchase_approval_levels"."level_order" between 1 and 20),
	CONSTRAINT "purchase_approval_levels_name_len_ck" CHECK (char_length("purchase_approval_levels"."name") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "purchase_order_lines" (
	"order_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"rate" numeric(14, 2) NOT NULL,
	"vat_percent" numeric(5, 2) NOT NULL,
	"received_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	CONSTRAINT "purchase_order_lines_order_id_position_pk" PRIMARY KEY("order_id","position"),
	CONSTRAINT "purchase_order_lines_amounts_ck" CHECK ("purchase_order_lines"."qty" > 0 and "purchase_order_lines"."rate" >= 0 and "purchase_order_lines"."vat_percent" between 0 and 100 and "purchase_order_lines"."received_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"main_store_id" uuid NOT NULL,
	"requisition_id" uuid,
	"comparative_study_id" uuid,
	"order_date" date NOT NULL,
	"expected_on" date,
	"terms" text,
	"note" text,
	"status" text NOT NULL,
	"cancel_reason" text,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_status_ck" CHECK ("purchase_orders"."status" in ('open', 'partially_received', 'received', 'closed', 'cancelled')),
	CONSTRAINT "purchase_orders_expected_ck" CHECK ("purchase_orders"."expected_on" is null or "purchase_orders"."expected_on" >= "purchase_orders"."order_date")
);
--> statement-breakpoint
CREATE TABLE "purchase_requisition_approvals" (
	"requisition_id" uuid NOT NULL,
	"level_order" smallint NOT NULL,
	"level_name" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"remarks" text,
	CONSTRAINT "purchase_requisition_approvals_requisition_id_level_order_pk" PRIMARY KEY("requisition_id","level_order"),
	CONSTRAINT "purchase_requisition_approvals_decision_ck" CHECK ("purchase_requisition_approvals"."decision" in ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "purchase_requisition_lines" (
	"requisition_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"requested_qty" numeric(14, 3) NOT NULL,
	"approved_qty" numeric(14, 3),
	"description" text,
	CONSTRAINT "purchase_requisition_lines_requisition_id_position_pk" PRIMARY KEY("requisition_id","position"),
	CONSTRAINT "purchase_requisition_lines_qty_ck" CHECK ("purchase_requisition_lines"."requested_qty" > 0 and ("purchase_requisition_lines"."approved_qty" is null or "purchase_requisition_lines"."approved_qty" between 0 and "purchase_requisition_lines"."requested_qty"))
);
--> statement-breakpoint
CREATE TABLE "purchase_requisitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"main_store_id" uuid NOT NULL,
	"sub_store_id" uuid,
	"department_id" uuid,
	"supplier_id" uuid,
	"requisition_date" date NOT NULL,
	"payment_term" text,
	"note" text,
	"terms" text,
	"status" text NOT NULL,
	"current_level" smallint,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_requisitions_status_ck" CHECK ("purchase_requisitions"."status" in ('draft', 'pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "purchase_requisitions_payment_term_ck" CHECK ("purchase_requisitions"."payment_term" is null or "purchase_requisitions"."payment_term" in ('cash', 'credit')),
	CONSTRAINT "purchase_requisitions_level_ck" CHECK (("purchase_requisitions"."status" = 'pending') = ("purchase_requisitions"."current_level" is not null))
);
--> statement-breakpoint
CREATE TABLE "scm_sequences" (
	"kind" text NOT NULL,
	"year" smallint NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "scm_sequences_kind_year_pk" PRIMARY KEY("kind","year")
);
--> statement-breakpoint
ALTER TABLE "comparative_studies" ADD CONSTRAINT "comparative_studies_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparative_studies" ADD CONSTRAINT "comparative_studies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparative_study_approvals" ADD CONSTRAINT "comparative_study_approvals_study_id_comparative_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."comparative_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparative_study_approvals" ADD CONSTRAINT "comparative_study_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparative_study_quotes" ADD CONSTRAINT "comparative_study_quotes_study_id_comparative_studies_id_fk" FOREIGN KEY ("study_id") REFERENCES "public"."comparative_studies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparative_study_quotes" ADD CONSTRAINT "comparative_study_quotes_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comparative_study_quotes" ADD CONSTRAINT "comparative_study_quotes_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cs_approval_levels" ADD CONSTRAINT "cs_approval_levels_approver_staff_id_staff_records_id_fk" FOREIGN KEY ("approver_staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_approval_levels" ADD CONSTRAINT "purchase_approval_levels_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_approval_levels" ADD CONSTRAINT "purchase_approval_levels_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_requisition_id_purchase_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_comparative_study_id_comparative_studies_id_fk" FOREIGN KEY ("comparative_study_id") REFERENCES "public"."comparative_studies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_approvals" ADD CONSTRAINT "purchase_requisition_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_approvals" ADD CONSTRAINT "purchase_requisition_approvals_requisition_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_requisition_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "comparative_studies_number_uq" ON "comparative_studies" USING btree ("number");--> statement-breakpoint
CREATE INDEX "comparative_studies_status_idx" ON "comparative_studies" USING btree ("status","study_date");--> statement-breakpoint
CREATE INDEX "comparative_study_quotes_study_idx" ON "comparative_study_quotes" USING btree ("study_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "cs_approval_levels_order_uq" ON "cs_approval_levels" USING btree ("level_order");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_approval_levels_order_uq" ON "purchase_approval_levels" USING btree ("main_store_id","level_order");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_order_lines_variant_uq" ON "purchase_order_lines" USING btree ("order_id","variant_id");--> statement-breakpoint
CREATE INDEX "purchase_order_lines_variant_idx" ON "purchase_order_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_number_uq" ON "purchase_orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id","order_date");--> statement-breakpoint
CREATE INDEX "purchase_orders_requisition_idx" ON "purchase_orders" USING btree ("requisition_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_status_idx" ON "purchase_orders" USING btree ("status","order_date");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requisition_lines_variant_uq" ON "purchase_requisition_lines" USING btree ("requisition_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_requisitions_number_uq" ON "purchase_requisitions" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_status_idx" ON "purchase_requisitions" USING btree ("status","requisition_date");--> statement-breakpoint
CREATE INDEX "purchase_requisitions_main_store_idx" ON "purchase_requisitions" USING btree ("main_store_id");