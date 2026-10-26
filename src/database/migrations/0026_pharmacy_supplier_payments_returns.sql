CREATE TABLE "pharmacy_supplier_payment_lines" (
	"payment_id" uuid NOT NULL,
	"receive_id" uuid NOT NULL,
	"due_before" numeric(14, 2) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "pharmacy_supplier_payment_lines_payment_id_receive_id_pk" PRIMARY KEY("payment_id","receive_id"),
	CONSTRAINT "pharmacy_supplier_payment_lines_amount_ck" CHECK ("pharmacy_supplier_payment_lines"."amount" > 0 and "pharmacy_supplier_payment_lines"."amount" <= "pharmacy_supplier_payment_lines"."due_before")
);
--> statement-breakpoint
CREATE TABLE "pharmacy_supplier_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"method" text NOT NULL,
	"bank_account_id" uuid,
	"reference" text,
	"remarks" text,
	"total" numeric(14, 2) NOT NULL,
	"voucher_id" uuid,
	"voucher_number" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_supplier_payments_method_ck" CHECK ("pharmacy_supplier_payments"."method" in ('cash', 'bank')),
	CONSTRAINT "pharmacy_supplier_payments_bank_ck" CHECK (("pharmacy_supplier_payments"."method" = 'bank') = ("pharmacy_supplier_payments"."bank_account_id" is not null) and "pharmacy_supplier_payments"."total" > 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_supplier_return_lines" (
	"return_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"unit_cost" numeric(16, 4),
	"value" numeric(14, 2),
	CONSTRAINT "pharmacy_supplier_return_lines_return_id_position_pk" PRIMARY KEY("return_id","position"),
	CONSTRAINT "pharmacy_supplier_return_lines_qty_ck" CHECK ("pharmacy_supplier_return_lines"."qty" > 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_supplier_return_settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"return_id" uuid NOT NULL,
	"settled_on" date NOT NULL,
	"product_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"qty" integer NOT NULL,
	"purchase_rate" numeric(16, 4) NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"voucher_number" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_supplier_return_settlements_ck" CHECK ("pharmacy_supplier_return_settlements"."qty" > 0 and "pharmacy_supplier_return_settlements"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "pharmacy_supplier_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"return_date" date NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"settled_value" numeric(14, 2) NOT NULL,
	"sent_voucher_number" text,
	"close_reason" text,
	"created_by" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pharmacy_supplier_returns_status_ck" CHECK ("pharmacy_supplier_returns"."status" in ('draft', 'sent', 'partly_settled', 'settled', 'closed')),
	CONSTRAINT "pharmacy_supplier_returns_value_ck" CHECK ("pharmacy_supplier_returns"."settled_value" between 0 and "pharmacy_supplier_returns"."value")
);
--> statement-breakpoint
ALTER TABLE "pharmacy_movements" DROP CONSTRAINT "pharmacy_movements_kind_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_receive_lines" DROP CONSTRAINT "pharmacy_receive_lines_qty_ck";--> statement-breakpoint
ALTER TABLE "pharmacy_receive_lines" ADD COLUMN "bonus_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_payment_lines" ADD CONSTRAINT "pharmacy_supplier_payment_lines_receive_id_pharmacy_receives_id_fk" FOREIGN KEY ("receive_id") REFERENCES "public"."pharmacy_receives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_payment_lines" ADD CONSTRAINT "pharmacy_supplier_payment_lines_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."pharmacy_supplier_payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_payments" ADD CONSTRAINT "pharmacy_supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_payments" ADD CONSTRAINT "pharmacy_supplier_payments_bank_account_id_gl_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_payments" ADD CONSTRAINT "pharmacy_supplier_payments_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_payments" ADD CONSTRAINT "pharmacy_supplier_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_return_lines" ADD CONSTRAINT "pharmacy_supplier_return_lines_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_return_lines" ADD CONSTRAINT "pharmacy_supplier_return_lines_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_return_lines" ADD CONSTRAINT "pharmacy_supplier_return_lines_fk" FOREIGN KEY ("return_id") REFERENCES "public"."pharmacy_supplier_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_return_settlements" ADD CONSTRAINT "pharmacy_supplier_return_settlements_return_id_pharmacy_supplier_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."pharmacy_supplier_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_return_settlements" ADD CONSTRAINT "pharmacy_supplier_return_settlements_product_id_pharmacy_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."pharmacy_products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_return_settlements" ADD CONSTRAINT "pharmacy_supplier_return_settlements_lot_id_pharmacy_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."pharmacy_lots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_return_settlements" ADD CONSTRAINT "pharmacy_supplier_return_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_returns" ADD CONSTRAINT "pharmacy_supplier_returns_outlet_id_pharmacy_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."pharmacy_outlets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_returns" ADD CONSTRAINT "pharmacy_supplier_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pharmacy_supplier_returns" ADD CONSTRAINT "pharmacy_supplier_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pharmacy_supplier_payment_lines_receive_idx" ON "pharmacy_supplier_payment_lines" USING btree ("receive_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_supplier_payments_number_uq" ON "pharmacy_supplier_payments" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_supplier_payments_supplier_idx" ON "pharmacy_supplier_payments" USING btree ("supplier_id","paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_supplier_return_lines_lot_uq" ON "pharmacy_supplier_return_lines" USING btree ("return_id","lot_id");--> statement-breakpoint
CREATE INDEX "pharmacy_supplier_return_settlements_return_idx" ON "pharmacy_supplier_return_settlements" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pharmacy_supplier_returns_number_uq" ON "pharmacy_supplier_returns" USING btree ("number");--> statement-breakpoint
CREATE INDEX "pharmacy_supplier_returns_supplier_idx" ON "pharmacy_supplier_returns" USING btree ("supplier_id","status");--> statement-breakpoint
ALTER TABLE "pharmacy_movements" ADD CONSTRAINT "pharmacy_movements_kind_ck" CHECK ("pharmacy_movements"."kind" in ('opening', 'receive', 'supplier_return', 'replacement'));--> statement-breakpoint
ALTER TABLE "pharmacy_receive_lines" ADD CONSTRAINT "pharmacy_receive_lines_qty_ck" CHECK ("pharmacy_receive_lines"."qty" > 0 and "pharmacy_receive_lines"."bonus_qty" >= 0);