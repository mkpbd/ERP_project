CREATE TABLE "pharmacy_outlet_indent_lines" (
	"indent_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"transferred_qty" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pharmacy_outlet_indent_lines_indent_id_position_pk" PRIMARY KEY("indent_id","position"),
	CONSTRAINT "pharmacy_outlet_indent_lines_qty_ck" CHECK ("pharmacy_outlet_indent_lines"."qty" > 0 and "pharmacy_outlet_indent_lines"."transferred_qty" between 0 and "pharmacy_outlet_indent_lines"."qty")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_outlet_indents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"requesting_outlet_id" uuid NOT NULL,
	"supplying_outlet_id" uuid NOT NULL,
	"indent_date" date NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"close_reason" text,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_outlet_indents_status_ck" CHECK ("pharmacy_outlet_indents"."status" in ('open', 'partly_transferred', 'transferred', 'closed', 'cancelled')),
	CONSTRAINT "pharmacy_outlet_indents_outlets_ck" CHECK ("pharmacy_outlet_indents"."requesting_outlet_id" <> "pharmacy_outlet_indents"."supplying_outlet_id")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_transfer_lines" (
	"transfer_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" numeric(16, 4) NOT NULL,
	CONSTRAINT "pharmacy_transfer_lines_transfer_id_position_pk" PRIMARY KEY("transfer_id","position"),
	CONSTRAINT "pharmacy_transfer_lines_qty_ck" CHECK ("pharmacy_transfer_lines"."qty" > 0 and "pharmacy_transfer_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"indent_id" uuid,
	"from_outlet_id" uuid NOT NULL,
	"to_outlet_id" uuid NOT NULL,
	"transfer_date" date NOT NULL,
	"note" text,
	"status" text NOT NULL,
	"decided_on" date,
	"decided_by" uuid,
	"reject_reason" text,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_transfers_status_ck" CHECK ("pharmacy_transfers"."status" in ('in_transit', 'accepted', 'rejected')),
	CONSTRAINT "pharmacy_transfers_outlets_ck" CHECK ("pharmacy_transfers"."from_outlet_id" <> "pharmacy_transfers"."to_outlet_id")
);
--> statement-breakpoint
ALTER TABLE "pharmacy_movements" DROP CONSTRAINT "pharmacy_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_outlet_indent_lines" ADD CONSTRAINT "pharmacy_outlet_indent_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_outlet_indent_lines" ADD CONSTRAINT "pharmacy_outlet_indent_lines_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."pharmacy_outlet_indents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_outlet_indents" ADD CONSTRAINT "pharmacy_outlet_indents_requesting_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("requesting_outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_outlet_indents" ADD CONSTRAINT "pharmacy_outlet_indents_supplying_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("supplying_outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_outlet_indents" ADD CONSTRAINT "pharmacy_outlet_indents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_transfer_lines" ADD CONSTRAINT "pharmacy_transfer_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_transfer_lines" ADD CONSTRAINT "pharmacy_transfer_lines_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_transfer_lines" ADD CONSTRAINT "pharmacy_transfer_lines_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."pharmacy_transfers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_transfers" ADD CONSTRAINT "pharmacy_transfers_indent_id_pharmacy_outlet_indents_id_fk" FOREIGN KEY ("indent_id") REFERENCES "public"."pharmacy_outlet_indents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_transfers" ADD CONSTRAINT "pharmacy_transfers_from_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("from_outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_transfers" ADD CONSTRAINT "pharmacy_transfers_to_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("to_outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_transfers" ADD CONSTRAINT "pharmacy_transfers_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_transfers" ADD CONSTRAINT "pharmacy_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_outlet_indent_lines_product_uq" ON "pharmacy_outlet_indent_lines" USING btree ("indent_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_outlet_indents_number_uq" ON "pharmacy_outlet_indents" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_outlet_indents_supplying_idx" ON "pharmacy_outlet_indents" USING btree ("supplying_outlet_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_transfers_number_uq" ON "pharmacy_transfers" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_transfers_to_idx" ON "pharmacy_transfers" USING btree ("to_outlet_id","status");--> statement-breakpoint
CREATE INDEX "pharmacy_transfers_indent_idx" ON "pharmacy_transfers" USING btree ("indent_id");--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_kind_ck" CHECK ("pharmacy_movements"."kind" in ('opening', 'receive', 'supplier_return', 'replacement', 'transfer_out', 'transfer_in'));