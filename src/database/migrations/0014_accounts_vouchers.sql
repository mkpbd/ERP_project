CREATE TABLE "gl_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"gl_account_id" uuid NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_roles_role_ck" CHECK ("gl_roles"."role" ~ '^[a-z][a-z0-9_.]{1,59}$')
);
--> statement-breakpoint
CREATE TABLE "posting_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"section" text NOT NULL,
	"timing" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "posting_schedules_timing_ck" CHECK ("posting_schedules"."timing" in ('on_sale', 'end_of_day', 'weekly', 'monthly')),
	CONSTRAINT "posting_schedules_section_len_ck" CHECK (char_length("posting_schedules"."section") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "voucher_attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"voucher_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_by" uuid,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voucher_attachments_type_ck" CHECK ("voucher_attachments"."content_type" in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "voucher_attachments_size_ck" CHECK (octet_length("voucher_attachments"."data") between 1 and 5242880)
);
--> statement-breakpoint
CREATE TABLE "voucher_lines" (
	"voucher_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"gl_account_id" uuid NOT NULL,
	"debit" numeric(14, 2) NOT NULL,
	"credit" numeric(14, 2) NOT NULL,
	"narration" text,
	"cost_center_id" uuid,
	"sub_ledger_id" uuid,
	"cheque_no" text,
	"cheque_date" date,
	CONSTRAINT "voucher_lines_voucher_id_position_pk" PRIMARY KEY("voucher_id","position"),
	CONSTRAINT "voucher_lines_amount_ck" CHECK ("voucher_lines"."debit" >= 0 and "voucher_lines"."credit" >= 0 and ("voucher_lines"."debit" > 0) <> ("voucher_lines"."credit" > 0))
);
--> statement-breakpoint
CREATE TABLE "voucher_sequences" (
	"journal_type_id" uuid NOT NULL,
	"fiscal_year_id" uuid NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "voucher_sequences_journal_type_id_fiscal_year_id_pk" PRIMARY KEY("journal_type_id","fiscal_year_id")
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"number" text,
	"journal_type_id" uuid NOT NULL,
	"fiscal_year_id" uuid,
	"voucher_date" date NOT NULL,
	"document_date" date,
	"narration" text,
	"paid_to" text,
	"mode" text,
	"service_unit_id" uuid,
	"status" text NOT NULL,
	"source_module" text,
	"source_reference" text,
	"reversal_of_id" uuid,
	"total" numeric(14, 2) NOT NULL,
	"created_by" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_status_ck" CHECK ("vouchers"."status" in ('draft', 'posted', 'reversed')),
	CONSTRAINT "vouchers_posted_ck" CHECK (("vouchers"."status" = 'draft') = ("vouchers"."number" is null) and ("vouchers"."status" = 'draft') = ("vouchers"."fiscal_year_id" is null)),
	CONSTRAINT "vouchers_source_ck" CHECK (("vouchers"."source_module" is null) = ("vouchers"."source_reference" is null))
);
--> statement-breakpoint
ALTER TABLE "gl_roles" ADD CONSTRAINT "gl_roles_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_attachments" ADD CONSTRAINT "voucher_attachments_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_attachments" ADD CONSTRAINT "voucher_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_voucher_id_vouchers_id_fk" FOREIGN KEY ("voucher_id") REFERENCES "public"."vouchers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_cost_center_id_cost_centers_id_fk" FOREIGN KEY ("cost_center_id") REFERENCES "public"."cost_centers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_lines" ADD CONSTRAINT "voucher_lines_sub_ledger_id_sub_ledgers_id_fk" FOREIGN KEY ("sub_ledger_id") REFERENCES "public"."sub_ledgers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_sequences" ADD CONSTRAINT "voucher_sequences_journal_type_id_journal_types_id_fk" FOREIGN KEY ("journal_type_id") REFERENCES "public"."journal_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voucher_sequences" ADD CONSTRAINT "voucher_sequences_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_journal_type_id_journal_types_id_fk" FOREIGN KEY ("journal_type_id") REFERENCES "public"."journal_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_fiscal_year_id_fiscal_years_id_fk" FOREIGN KEY ("fiscal_year_id") REFERENCES "public"."fiscal_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_service_unit_id_service_units_id_fk" FOREIGN KEY ("service_unit_id") REFERENCES "public"."service_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_reversal_of_id_vouchers_id_fk" FOREIGN KEY ("reversal_of_id") REFERENCES "public"."vouchers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gl_roles_role_uq" ON "gl_roles" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "posting_schedules_section_uq" ON "posting_schedules" USING btree ("section");--> statement-breakpoint
CREATE INDEX "voucher_attachments_voucher_idx" ON "voucher_attachments" USING btree ("voucher_id");--> statement-breakpoint
CREATE INDEX "voucher_lines_account_idx" ON "voucher_lines" USING btree ("gl_account_id");--> statement-breakpoint
CREATE INDEX "voucher_lines_sub_ledger_idx" ON "voucher_lines" USING btree ("sub_ledger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_number_uq" ON "vouchers" USING btree ("number");--> statement-breakpoint
CREATE INDEX "vouchers_date_idx" ON "vouchers" USING btree ("voucher_date","status");--> statement-breakpoint
CREATE INDEX "vouchers_source_idx" ON "vouchers" USING btree ("source_module","source_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "vouchers_reversal_uq" ON "vouchers" USING btree ("reversal_of_id");