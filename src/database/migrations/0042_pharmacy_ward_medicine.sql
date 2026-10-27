CREATE TABLE "pharmacy_ward_indent_lines" (
	"indent_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "pharmacy_ward_indent_lines_indent_id_position_pk" PRIMARY KEY("indent_id","position"),
	CONSTRAINT "pharmacy_ward_indent_lines_qty_ck" CHECK ("pharmacy_ward_indent_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_ward_indents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"requested_on" date NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"cancel_reason" text,
	"issue_id" uuid,
	"requested_by" uuid,
	"closed_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pharmacy_ward_issue_lines" (
	"issue_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"sale_rate" numeric(14, 2) NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount_percent" numeric(5, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"returned_qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pharmacy_ward_issue_lines_issue_id_position_pk" PRIMARY KEY("issue_id","position"),
	CONSTRAINT "pharmacy_ward_issue_lines_qty_ck" CHECK ("pharmacy_ward_issue_lines"."qty" > 0 and "pharmacy_ward_issue_lines"."returned_qty" between 0 and "pharmacy_ward_issue_lines"."qty")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_ward_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"admission_id" uuid NOT NULL,
	"indent_id" uuid,
	"issued_on" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"returned" numeric(14, 2) DEFAULT 0 NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"voucher_number" text,
	"issued_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_ward_issues_amounts_ck" CHECK ("pharmacy_ward_issues"."discount" >= 0 and "pharmacy_ward_issues"."total" = "pharmacy_ward_issues"."amount" - "pharmacy_ward_issues"."discount" and "pharmacy_ward_issues"."returned" between 0 and "pharmacy_ward_issues"."total")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_ward_return_lines" (
	"return_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"issue_line" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	CONSTRAINT "pharmacy_ward_return_lines_return_id_position_pk" PRIMARY KEY("return_id","position"),
	CONSTRAINT "pharmacy_ward_return_lines_qty_ck" CHECK ("pharmacy_ward_return_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_ward_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"issue_id" uuid NOT NULL,
	"returned_on" date NOT NULL,
	"reason" text,
	"amount" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"cost" numeric(14, 2) NOT NULL,
	"voucher_number" text,
	"returned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pharmacy_movements" DROP CONSTRAINT "pharmacy_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_ward_indent_lines" ADD CONSTRAINT "pharmacy_ward_indent_lines_indent_id_pharmacy_ward_indents_id_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."pharmacy_ward_indents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_indent_lines" ADD CONSTRAINT "pharmacy_ward_indent_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_indents" ADD CONSTRAINT "pharmacy_ward_indents_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_indents" ADD CONSTRAINT "pharmacy_ward_indents_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_indents" ADD CONSTRAINT "pharmacy_ward_indents_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_indents" ADD CONSTRAINT "pharmacy_ward_indents_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_issue_lines" ADD CONSTRAINT "pharmacy_ward_issue_lines_issue_id_pharmacy_ward_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."pharmacy_ward_issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_issue_lines" ADD CONSTRAINT "pharmacy_ward_issue_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_issue_lines" ADD CONSTRAINT "pharmacy_ward_issue_lines_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_issues" ADD CONSTRAINT "pharmacy_ward_issues_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_issues" ADD CONSTRAINT "pharmacy_ward_issues_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_issues" ADD CONSTRAINT "pharmacy_ward_issues_indent_id_pharmacy_ward_indents_id_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."pharmacy_ward_indents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_issues" ADD CONSTRAINT "pharmacy_ward_issues_issued_by_users_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_return_lines" ADD CONSTRAINT "pharmacy_ward_return_lines_return_id_pharmacy_ward_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."pharmacy_ward_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_return_lines" ADD CONSTRAINT "pharmacy_ward_return_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_return_lines" ADD CONSTRAINT "pharmacy_ward_return_lines_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_returns" ADD CONSTRAINT "pharmacy_ward_returns_issue_id_pharmacy_ward_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."pharmacy_ward_issues"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_ward_returns" ADD CONSTRAINT "pharmacy_ward_returns_returned_by_users_id_fk" FOREIGN KEY ("returned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_ward_indents_number_uq" ON "pharmacy_ward_indents" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_ward_indents_admission_idx" ON "pharmacy_ward_indents" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "pharmacy_ward_indents_outlet_idx" ON "pharmacy_ward_indents" USING btree ("outlet_id","status");--> statement-breakpoint
CREATE INDEX "pharmacy_ward_issue_lines_product_idx" ON "pharmacy_ward_issue_lines" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_ward_issues_number_uq" ON "pharmacy_ward_issues" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_ward_issues_admission_idx" ON "pharmacy_ward_issues" USING btree ("admission_id");--> statement-breakpoint
CREATE INDEX "pharmacy_ward_issues_issued_idx" ON "pharmacy_ward_issues" USING btree ("outlet_id","issued_on");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_ward_returns_number_uq" ON "pharmacy_ward_returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_ward_returns_issue_idx" ON "pharmacy_ward_returns" USING btree ("issue_id");--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_kind_ck" CHECK ("pharmacy_movements"."kind" in ('opening', 'receive', 'supplier_return', 'replacement', 'transfer_out', 'transfer_in', 'sale', 'sale_cancel', 'sale_return', 'count_adjustment', 'ward_issue', 'ward_return'));