CREATE TABLE "account_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"nature_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_categories_code_len_ck" CHECK (char_length("account_categories"."code") between 1 and 30),
	CONSTRAINT "account_categories_name_len_ck" CHECK (char_length("account_categories"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "account_group_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"gl_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_groups_name_len_ck" CHECK (char_length("account_groups"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "account_level4_heads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sub_category_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_level4_heads_name_len_ck" CHECK (char_length("account_level4_heads"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "account_level5_heads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"level4_head_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_level5_heads_name_len_ck" CHECK (char_length("account_level5_heads"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "account_natures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"statement" text NOT NULL,
	"normal_balance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_natures_code_len_ck" CHECK (char_length("account_natures"."code") between 1 and 30),
	CONSTRAINT "account_natures_name_len_ck" CHECK (char_length("account_natures"."name") between 1 and 150),
	CONSTRAINT "account_natures_statement_ck" CHECK ("account_natures"."statement" in ('balance_sheet', 'profit_and_loss')),
	CONSTRAINT "account_natures_balance_ck" CHECK ("account_natures"."normal_balance" in ('debit', 'credit'))
);
--> statement-breakpoint
CREATE TABLE "account_sub_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"category_id" uuid NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_sub_categories_name_len_ck" CHECK (char_length("account_sub_categories"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bank_name" text NOT NULL,
	"branch" text,
	"contact_no" text,
	"account_no" text NOT NULL,
	"signatories" text,
	"gl_account_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_accounts_name_len_ck" CHECK (char_length("bank_accounts"."bank_name") between 1 and 100),
	CONSTRAINT "bank_accounts_no_len_ck" CHECK (char_length("bank_accounts"."account_no") between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "coa_descriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coa_descriptions_name_len_ck" CHECK (char_length("coa_descriptions"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "cost_centers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_centers_name_len_ck" CHECK (char_length("cost_centers"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "fiscal_years" (
	"id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"is_closed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fiscal_years_dates_ck" CHECK ("fiscal_years"."ends_on" > "fiscal_years"."starts_on"),
	CONSTRAINT "fiscal_years_label_len_ck" CHECK (char_length("fiscal_years"."label") between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "fs_line_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fs_line_items_name_len_ck" CHECK (char_length("fs_line_items"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "gl_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"level5_head_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"coa_description_id" uuid,
	"is_control_account" boolean DEFAULT false NOT NULL,
	"requires_cost_center" boolean DEFAULT false NOT NULL,
	"is_recurring_cost" boolean DEFAULT false NOT NULL,
	"billing_has_details" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_accounts_code_len_ck" CHECK (char_length("gl_accounts"."code") between 1 and 30),
	CONSTRAINT "gl_accounts_name_len_ck" CHECK (char_length("gl_accounts"."name") between 1 and 200),
	CONSTRAINT "gl_accounts_kind_ck" CHECK ("gl_accounts"."kind" in ('bank', 'cash', 'other'))
);
--> statement-breakpoint
CREATE TABLE "gl_item_descriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sub_category_id" uuid NOT NULL,
	"fs_line_item_id" uuid,
	"coa_description_id" uuid,
	"code" text,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gl_item_descriptions_name_len_ck" CHECK (char_length("gl_item_descriptions"."name") between 1 and 250)
);
--> statement-breakpoint
CREATE TABLE "gl_statement_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gl_account_id" uuid NOT NULL,
	"sub_head_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"short_name" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_types_short_name_len_ck" CHECK (char_length("journal_types"."short_name") between 1 and 10),
	CONSTRAINT "journal_types_name_len_ck" CHECK (char_length("journal_types"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "pos_terminals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pos_terminals_name_len_ck" CHECK (char_length("pos_terminals"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "statement_broad_heads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_broad_heads_name_len_ck" CHECK (char_length("statement_broad_heads"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "statement_sub_heads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"broad_head_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_sub_heads_name_len_ck" CHECK (char_length("statement_sub_heads"."name") between 1 and 150)
);
--> statement-breakpoint
CREATE TABLE "sub_ledger_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_ledger_types_name_len_ck" CHECK (char_length("sub_ledger_types"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "sub_ledgers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"mobile_no" text,
	"email" text,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_ledgers_name_len_ck" CHECK (char_length("sub_ledgers"."name") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "voucher_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voucher_types_code_len_ck" CHECK (char_length("voucher_types"."code") between 1 and 30),
	CONSTRAINT "voucher_types_title_len_ck" CHECK (char_length("voucher_types"."title") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "account_categories" ADD CONSTRAINT "account_categories_nature_id_account_natures_id_fk" FOREIGN KEY ("nature_id") REFERENCES "public"."account_natures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_group_id_account_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."account_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_members" ADD CONSTRAINT "account_group_members_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_level4_heads" ADD CONSTRAINT "account_level4_heads_sub_category_id_account_sub_categories_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."account_sub_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_level5_heads" ADD CONSTRAINT "account_level5_heads_level4_head_id_account_level4_heads_id_fk" FOREIGN KEY ("level4_head_id") REFERENCES "public"."account_level4_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_sub_categories" ADD CONSTRAINT "account_sub_categories_category_id_account_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."account_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_level5_head_id_account_level5_heads_id_fk" FOREIGN KEY ("level5_head_id") REFERENCES "public"."account_level5_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_accounts" ADD CONSTRAINT "gl_accounts_coa_description_id_coa_descriptions_id_fk" FOREIGN KEY ("coa_description_id") REFERENCES "public"."coa_descriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_item_descriptions" ADD CONSTRAINT "gl_item_descriptions_sub_category_id_account_sub_categories_id_fk" FOREIGN KEY ("sub_category_id") REFERENCES "public"."account_sub_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_item_descriptions" ADD CONSTRAINT "gl_item_descriptions_fs_line_item_id_fs_line_items_id_fk" FOREIGN KEY ("fs_line_item_id") REFERENCES "public"."fs_line_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_item_descriptions" ADD CONSTRAINT "gl_item_descriptions_coa_description_id_coa_descriptions_id_fk" FOREIGN KEY ("coa_description_id") REFERENCES "public"."coa_descriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_statement_mappings" ADD CONSTRAINT "gl_statement_mappings_gl_account_id_gl_accounts_id_fk" FOREIGN KEY ("gl_account_id") REFERENCES "public"."gl_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gl_statement_mappings" ADD CONSTRAINT "gl_statement_mappings_sub_head_id_statement_sub_heads_id_fk" FOREIGN KEY ("sub_head_id") REFERENCES "public"."statement_sub_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pos_terminals" ADD CONSTRAINT "pos_terminals_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_sub_heads" ADD CONSTRAINT "statement_sub_heads_broad_head_id_statement_broad_heads_id_fk" FOREIGN KEY ("broad_head_id") REFERENCES "public"."statement_broad_heads"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sub_ledgers" ADD CONSTRAINT "sub_ledgers_type_id_sub_ledger_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."sub_ledger_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_categories_code_uq" ON "account_categories" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "account_categories_name_uq" ON "account_categories" USING btree ("nature_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "account_group_members_uq" ON "account_group_members" USING btree ("group_id","gl_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_groups_name_uq" ON "account_groups" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "account_level4_heads_name_uq" ON "account_level4_heads" USING btree ("sub_category_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "account_level5_heads_name_uq" ON "account_level5_heads" USING btree ("level4_head_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "account_natures_code_uq" ON "account_natures" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "account_natures_name_uq" ON "account_natures" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "account_sub_categories_name_uq" ON "account_sub_categories" USING btree ("category_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_number_uq" ON "bank_accounts" USING btree (lower("bank_name"),"account_no");--> statement-breakpoint
CREATE UNIQUE INDEX "coa_descriptions_name_uq" ON "coa_descriptions" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "cost_centers_name_uq" ON "cost_centers" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_years_label_uq" ON "fiscal_years" USING btree ("label");--> statement-breakpoint
CREATE UNIQUE INDEX "fiscal_years_start_uq" ON "fiscal_years" USING btree ("starts_on");--> statement-breakpoint
CREATE UNIQUE INDEX "fs_line_items_name_uq" ON "fs_line_items" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "gl_accounts_code_uq" ON "gl_accounts" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "gl_accounts_level5_idx" ON "gl_accounts" USING btree ("level5_head_id");--> statement-breakpoint
CREATE INDEX "gl_item_descriptions_sub_category_idx" ON "gl_item_descriptions" USING btree ("sub_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gl_statement_mappings_account_uq" ON "gl_statement_mappings" USING btree ("gl_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_types_short_name_uq" ON "journal_types" USING btree (upper("short_name"));--> statement-breakpoint
CREATE UNIQUE INDEX "pos_terminals_name_uq" ON "pos_terminals" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "statement_broad_heads_name_uq" ON "statement_broad_heads" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "statement_sub_heads_name_uq" ON "statement_sub_heads" USING btree ("broad_head_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "sub_ledger_types_name_uq" ON "sub_ledger_types" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "sub_ledgers_type_idx" ON "sub_ledgers" USING btree ("type_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_types_code_uq" ON "voucher_types" USING btree (upper("code"));