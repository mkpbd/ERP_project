CREATE TABLE "stock_transfer_lines" (
	"transfer_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"accepted_qty" numeric(14, 3),
	"lot_id" uuid,
	CONSTRAINT "stock_transfer_lines_transfer_id_position_pk" PRIMARY KEY("transfer_id","position"),
	CONSTRAINT "stock_transfer_lines_qty_ck" CHECK ("stock_transfer_lines"."qty" > 0 and ("stock_transfer_lines"."accepted_qty" is null or "stock_transfer_lines"."accepted_qty" between 0 and "stock_transfer_lines"."qty"))
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"kind" text NOT NULL,
	"from_main_store_id" uuid,
	"from_sub_store_id" uuid,
	"to_main_store_id" uuid,
	"to_sub_store_id" uuid,
	"request_id" uuid,
	"transfer_date" date NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"reject_reason" text,
	"sent_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_transfers_kind_ck" CHECK ("stock_transfers"."kind" in ('main_to_sub', 'sub_to_main', 'sub_to_sub')),
	CONSTRAINT "stock_transfers_status_ck" CHECK ("stock_transfers"."status" in ('pending', 'completed', 'rejected')),
	CONSTRAINT "stock_transfers_stores_ck" CHECK (("stock_transfers"."kind" = 'main_to_sub' and "stock_transfers"."from_main_store_id" is not null and "stock_transfers"."to_sub_store_id" is not null
            and "stock_transfers"."from_sub_store_id" is null and "stock_transfers"."to_main_store_id" is null)
        or ("stock_transfers"."kind" = 'sub_to_main' and "stock_transfers"."from_sub_store_id" is not null and "stock_transfers"."to_main_store_id" is not null
            and "stock_transfers"."from_main_store_id" is null and "stock_transfers"."to_sub_store_id" is null)
        or ("stock_transfers"."kind" = 'sub_to_sub' and "stock_transfers"."from_sub_store_id" is not null and "stock_transfers"."to_sub_store_id" is not null
            and "stock_transfers"."from_main_store_id" is null and "stock_transfers"."to_main_store_id" is null and "stock_transfers"."from_sub_store_id" <> "stock_transfers"."to_sub_store_id"))
);
--> statement-breakpoint
CREATE TABLE "store_indent_approval_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sub_store_id" uuid NOT NULL,
	"level_order" smallint NOT NULL,
	"name" text NOT NULL,
	"role_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_indent_approval_levels_order_ck" CHECK ("store_indent_approval_levels"."level_order" between 1 and 20),
	CONSTRAINT "store_indent_approval_levels_name_len_ck" CHECK (char_length("store_indent_approval_levels"."name") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "store_indent_approvals" (
	"indent_id" uuid NOT NULL,
	"level_order" smallint NOT NULL,
	"level_name" text NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone NOT NULL,
	"remarks" text,
	CONSTRAINT "store_indent_approvals_indent_id_level_order_pk" PRIMARY KEY("indent_id","level_order"),
	CONSTRAINT "store_indent_approvals_decision_ck" CHECK ("store_indent_approvals"."decision" in ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "store_indent_lines" (
	"indent_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"approved_qty" numeric(14, 3),
	"served_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	"remarks" text,
	CONSTRAINT "store_indent_lines_indent_id_position_pk" PRIMARY KEY("indent_id","position"),
	CONSTRAINT "store_indent_lines_qty_ck" CHECK ("store_indent_lines"."qty" > 0 and ("store_indent_lines"."approved_qty" is null or "store_indent_lines"."approved_qty" between 0 and "store_indent_lines"."qty") and "store_indent_lines"."served_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store_indents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"sub_store_id" uuid NOT NULL,
	"department_id" uuid,
	"indent_date" date NOT NULL,
	"priority" text NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"current_level" smallint,
	"created_by" uuid,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_indents_status_ck" CHECK ("store_indents"."status" in ('draft', 'pending', 'approved', 'partially_served', 'served', 'acknowledged', 'rejected', 'cancelled')),
	CONSTRAINT "store_indents_priority_ck" CHECK ("store_indents"."priority" in ('routine', 'emergency', 'critical_care', 'new_admission', 'discharge', 'other')),
	CONSTRAINT "store_indents_level_ck" CHECK (("store_indents"."status" = 'pending') = ("store_indents"."current_level" is not null))
);
--> statement-breakpoint
CREATE TABLE "store_issue_lines" (
	"issue_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"lot_id" uuid,
	CONSTRAINT "store_issue_lines_issue_id_position_pk" PRIMARY KEY("issue_id","position"),
	CONSTRAINT "store_issue_lines_qty_ck" CHECK ("store_issue_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "store_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"sub_store_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"indent_id" uuid,
	"issue_date" date NOT NULL,
	"received_by_staff_id" uuid,
	"note" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_request_lines" (
	"request_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"variant_id" uuid NOT NULL,
	"qty" numeric(14, 3) NOT NULL,
	"served_qty" numeric(14, 3) DEFAULT 0 NOT NULL,
	CONSTRAINT "store_request_lines_request_id_position_pk" PRIMARY KEY("request_id","position"),
	CONSTRAINT "store_request_lines_qty_ck" CHECK ("store_request_lines"."qty" > 0 and "store_request_lines"."served_qty" >= 0)
);
--> statement-breakpoint
CREATE TABLE "store_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"sub_store_id" uuid NOT NULL,
	"main_store_id" uuid NOT NULL,
	"request_date" date NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"purchase_requisition_id" uuid,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_requests_status_ck" CHECK ("store_requests"."status" in ('open', 'partially_served', 'served', 'closed'))
);
--> statement-breakpoint
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_main_store_id_main_stores_id_fk" FOREIGN KEY ("from_main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("from_sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_main_store_id_main_stores_id_fk" FOREIGN KEY ("to_main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("to_sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_request_id_store_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."store_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indent_approval_levels" ADD CONSTRAINT "store_indent_approval_levels_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indent_approval_levels" ADD CONSTRAINT "store_indent_approval_levels_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indent_approvals" ADD CONSTRAINT "store_indent_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indent_approvals" ADD CONSTRAINT "store_indent_approvals_indent_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."store_indents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indent_lines" ADD CONSTRAINT "store_indent_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indent_lines" ADD CONSTRAINT "store_indent_lines_indent_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."store_indents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indents" ADD CONSTRAINT "store_indents_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indents" ADD CONSTRAINT "store_indents_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indents" ADD CONSTRAINT "store_indents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_indents" ADD CONSTRAINT "store_indents_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_issue_lines" ADD CONSTRAINT "store_issue_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_issue_lines" ADD CONSTRAINT "store_issue_lines_lot_id_stock_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."stock_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_issue_lines" ADD CONSTRAINT "store_issue_lines_issue_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."store_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_issues" ADD CONSTRAINT "store_issues_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_issues" ADD CONSTRAINT "store_issues_department_id_store_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."store_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_issues" ADD CONSTRAINT "store_issues_indent_id_store_indents_id_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."store_indents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_issues" ADD CONSTRAINT "store_issues_received_by_staff_id_staff_records_id_fk" FOREIGN KEY ("received_by_staff_id") REFERENCES "public"."staff_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_issues" ADD CONSTRAINT "store_issues_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_request_lines" ADD CONSTRAINT "store_request_lines_variant_id_item_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."item_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_request_lines" ADD CONSTRAINT "store_request_lines_request_fk" FOREIGN KEY ("request_id") REFERENCES "public"."store_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_requests" ADD CONSTRAINT "store_requests_sub_store_id_sub_stores_id_fk" FOREIGN KEY ("sub_store_id") REFERENCES "public"."sub_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_requests" ADD CONSTRAINT "store_requests_main_store_id_main_stores_id_fk" FOREIGN KEY ("main_store_id") REFERENCES "public"."main_stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_requests" ADD CONSTRAINT "store_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_requests" ADD CONSTRAINT "store_requests_purchase_requisition_fk" FOREIGN KEY ("purchase_requisition_id") REFERENCES "public"."purchase_requisitions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfers_number_uq" ON "stock_transfers" USING btree ("number");--> statement-breakpoint
CREATE INDEX "stock_transfers_date_idx" ON "stock_transfers" USING btree ("transfer_date");--> statement-breakpoint
CREATE INDEX "stock_transfers_request_idx" ON "stock_transfers" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_indent_approval_levels_order_uq" ON "store_indent_approval_levels" USING btree ("sub_store_id","level_order");--> statement-breakpoint
CREATE UNIQUE INDEX "store_indent_lines_variant_uq" ON "store_indent_lines" USING btree ("indent_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_indents_number_uq" ON "store_indents" USING btree ("number");--> statement-breakpoint
CREATE INDEX "store_indents_store_idx" ON "store_indents" USING btree ("sub_store_id","status");--> statement-breakpoint
CREATE INDEX "store_indents_date_idx" ON "store_indents" USING btree ("indent_date");--> statement-breakpoint
CREATE UNIQUE INDEX "store_issues_number_uq" ON "store_issues" USING btree ("number");--> statement-breakpoint
CREATE INDEX "store_issues_store_idx" ON "store_issues" USING btree ("sub_store_id","issue_date");--> statement-breakpoint
CREATE INDEX "store_issues_department_idx" ON "store_issues" USING btree ("department_id","issue_date");--> statement-breakpoint
CREATE INDEX "store_issues_indent_idx" ON "store_issues" USING btree ("indent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_request_lines_variant_uq" ON "store_request_lines" USING btree ("request_id","variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "store_requests_number_uq" ON "store_requests" USING btree ("number");--> statement-breakpoint
CREATE INDEX "store_requests_main_idx" ON "store_requests" USING btree ("main_store_id","status");--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_kind_ck" CHECK ("stock_movements"."kind" in ('opening', 'receive', 'issue', 'transfer'));