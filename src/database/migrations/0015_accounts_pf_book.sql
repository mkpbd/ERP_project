CREATE TABLE "pf_deposits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"cheque_no" text,
	"cheque_date" date,
	"deposited_on" date,
	"voucher_id" uuid,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pf_deposits_period_ck" CHECK ("pf_deposits"."year" between 2000 and 2100 and "pf_deposits"."month" between 1 and 12),
	CONSTRAINT "pf_deposits_amount_ck" CHECK ("pf_deposits"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "pf_fixed_deposits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"fdr_no" text NOT NULL,
	"bank_name" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"interest_rate_percent" numeric(5, 2),
	"opened_on" date NOT NULL,
	"matures_on" date NOT NULL,
	"withdrawn_on" date,
	"withdrawn_amount" numeric(14, 2),
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pf_fixed_deposits_amount_ck" CHECK ("pf_fixed_deposits"."amount" > 0),
	CONSTRAINT "pf_fixed_deposits_dates_ck" CHECK ("pf_fixed_deposits"."matures_on" > "pf_fixed_deposits"."opened_on"),
	CONSTRAINT "pf_fixed_deposits_withdrawal_ck" CHECK (("pf_fixed_deposits"."withdrawn_on" is null) = ("pf_fixed_deposits"."withdrawn_amount" is null) and ("pf_fixed_deposits"."withdrawn_on" is null or "pf_fixed_deposits"."withdrawn_on" >= "pf_fixed_deposits"."opened_on"))
);
--> statement-breakpoint
CREATE TABLE "tds_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section" text,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"rate_percent" numeric(5, 2) NOT NULL,
	"effective_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tds_rules_rate_ck" CHECK ("tds_rules"."rate_percent" between 0 and 100),
	CONSTRAINT "tds_rules_description_len_ck" CHECK (char_length("tds_rules"."description") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "account_natures" ADD COLUMN "book" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "journal_types" ADD COLUMN "book" text DEFAULT 'main' NOT NULL;--> statement-breakpoint
ALTER TABLE "sub_ledgers" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "pf_deposits" ADD CONSTRAINT "pf_deposits_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pf_deposits_period_uq" ON "pf_deposits" USING btree ("year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "pf_fixed_deposits_no_uq" ON "pf_fixed_deposits" USING btree (upper("fdr_no"));--> statement-breakpoint
CREATE INDEX "tds_rules_category_idx" ON "tds_rules" USING btree ("category");--> statement-breakpoint
ALTER TABLE "sub_ledgers" ADD CONSTRAINT "sub_ledgers_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_natures" ADD CONSTRAINT "account_natures_book_ck" CHECK ("account_natures"."book" in ('main', 'pf'));--> statement-breakpoint
ALTER TABLE "journal_types" ADD CONSTRAINT "journal_types_book_ck" CHECK ("journal_types"."book" in ('main', 'pf'));