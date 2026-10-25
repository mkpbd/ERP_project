CREATE TABLE "leave_application_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"level_order" smallint NOT NULL,
	"decision" text NOT NULL,
	"approver_staff_id" uuid,
	"decided_by" uuid,
	"start_date" date,
	"end_date" date,
	"remarks" text,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "leave_application_approvals_decision_ck" CHECK ("leave_application_approvals"."decision" in ('approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "leave_applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" smallint NOT NULL,
	"reason" text NOT NULL,
	"substitute_staff_id" uuid,
	"status" text NOT NULL,
	"current_level" smallint NOT NULL,
	"level_count" smallint NOT NULL,
	"approved_start_date" date,
	"approved_end_date" date,
	"approved_days" smallint,
	"decision_reason" text,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "leave_applications_status_ck" CHECK ("leave_applications"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_applications_period_ck" CHECK ("leave_applications"."end_date" >= "leave_applications"."start_date" and extract(year from "leave_applications"."start_date") = extract(year from "leave_applications"."end_date")),
	CONSTRAINT "leave_applications_days_ck" CHECK ("leave_applications"."days" = "leave_applications"."end_date" - "leave_applications"."start_date" + 1),
	CONSTRAINT "leave_applications_approved_ck" CHECK ("leave_applications"."status" <> 'approved' or ("leave_applications"."approved_start_date" >= "leave_applications"."start_date" and "leave_applications"."approved_end_date" <= "leave_applications"."end_date"))
);
--> statement-breakpoint
CREATE TABLE "leave_approval_levels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid NOT NULL,
	"level_order" smallint NOT NULL,
	"name" text NOT NULL,
	"approver_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_approval_levels_order_ck" CHECK ("leave_approval_levels"."level_order" between 1 and 20)
);
--> statement-breakpoint
CREATE TABLE "leave_delegates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"on_behalf_of_staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_delegates_not_self_ck" CHECK ("leave_delegates"."staff_id" <> "leave_delegates"."on_behalf_of_staff_id")
);
--> statement-breakpoint
CREATE TABLE "leave_policies" (
	"year" smallint PRIMARY KEY NOT NULL,
	"late_grace_minutes" smallint DEFAULT 0 NOT NULL,
	"late_count_per_deduction" smallint DEFAULT 0 NOT NULL,
	"absent_deduction" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "leave_policies_year_ck" CHECK ("leave_policies"."year" between 2000 and 2100)
);
--> statement-breakpoint
CREATE TABLE "leave_policy_entitlements" (
	"year" smallint NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"days" smallint NOT NULL,
	CONSTRAINT "leave_policy_entitlements_pk" PRIMARY KEY("year","leave_type_id"),
	CONSTRAINT "leave_policy_entitlements_days_ck" CHECK ("leave_policy_entitlements"."days" between 0 and 366)
);
--> statement-breakpoint
CREATE TABLE "leave_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" integer GENERATED ALWAYS AS (end_date - start_date + 1) STORED NOT NULL,
	"purpose" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_records_period_ck" CHECK ("leave_records"."end_date" >= "leave_records"."start_date" and extract(year from "leave_records"."start_date") = extract(year from "leave_records"."end_date"))
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_bn" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_code_ck" CHECK ("leave_types"."code" ~ '^[A-Za-z][A-Za-z0-9-]{0,9}$')
);
--> statement-breakpoint
CREATE TABLE "staff_leave_entitlements" (
	"staff_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"days" smallint NOT NULL,
	CONSTRAINT "staff_leave_entitlements_pk" PRIMARY KEY("staff_id","year","leave_type_id"),
	CONSTRAINT "staff_leave_entitlements_days_ck" CHECK ("staff_leave_entitlements"."days" between 0 and 366)
);
--> statement-breakpoint
CREATE TABLE "staff_leave_policies" (
	"staff_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"late_grace_minutes" smallint DEFAULT 0 NOT NULL,
	"late_count_per_deduction" smallint DEFAULT 0 NOT NULL,
	"absent_deduction" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "staff_leave_policies_pk" PRIMARY KEY("staff_id","year"),
	CONSTRAINT "staff_leave_policies_year_ck" CHECK ("staff_leave_policies"."year" between 2000 and 2100)
);
--> statement-breakpoint
ALTER TABLE "leave_application_approvals" ADD CONSTRAINT "leave_application_approvals_application_id_leave_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."leave_applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_application_approvals" ADD CONSTRAINT "leave_application_approvals_approver_staff_id_staff_records_id_fk" FOREIGN KEY ("approver_staff_id") REFERENCES "public"."staff_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_application_approvals" ADD CONSTRAINT "leave_application_approvals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_substitute_staff_id_staff_records_id_fk" FOREIGN KEY ("substitute_staff_id") REFERENCES "public"."staff_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_applications" ADD CONSTRAINT "leave_applications_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_approval_levels" ADD CONSTRAINT "leave_approval_levels_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_approval_levels" ADD CONSTRAINT "leave_approval_levels_approver_staff_id_staff_records_id_fk" FOREIGN KEY ("approver_staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_delegates" ADD CONSTRAINT "leave_delegates_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_delegates" ADD CONSTRAINT "leave_delegates_on_behalf_of_staff_id_staff_records_id_fk" FOREIGN KEY ("on_behalf_of_staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policy_entitlements" ADD CONSTRAINT "leave_policy_entitlements_year_leave_policies_year_fk" FOREIGN KEY ("year") REFERENCES "public"."leave_policies"("year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_policy_entitlements" ADD CONSTRAINT "leave_policy_entitlements_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_records" ADD CONSTRAINT "leave_records_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_records" ADD CONSTRAINT "leave_records_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_entitlements" ADD CONSTRAINT "staff_leave_entitlements_leave_type_id_leave_types_id_fk" FOREIGN KEY ("leave_type_id") REFERENCES "public"."leave_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_entitlements" ADD CONSTRAINT "staff_leave_entitlements_policy_fk" FOREIGN KEY ("staff_id","year") REFERENCES "public"."staff_leave_policies"("staff_id","year") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_policies" ADD CONSTRAINT "staff_leave_policies_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_leave_policies" ADD CONSTRAINT "staff_leave_policies_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_application_approvals_level_uq" ON "leave_application_approvals" USING btree ("application_id","level_order");--> statement-breakpoint
CREATE INDEX "leave_applications_staff_idx" ON "leave_applications" USING btree ("staff_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_applications_pending_idx" ON "leave_applications" USING btree ("department_id","current_level") WHERE "leave_applications"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "leave_approval_levels_department_order_uq" ON "leave_approval_levels" USING btree ("department_id","level_order");--> statement-breakpoint
CREATE INDEX "leave_approval_levels_approver_idx" ON "leave_approval_levels" USING btree ("approver_staff_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_delegates_pair_uq" ON "leave_delegates" USING btree ("staff_id","on_behalf_of_staff_id");--> statement-breakpoint
CREATE INDEX "leave_delegates_on_behalf_idx" ON "leave_delegates" USING btree ("on_behalf_of_staff_id");--> statement-breakpoint
CREATE INDEX "leave_records_staff_idx" ON "leave_records" USING btree ("staff_id","start_date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_code_uq" ON "leave_types" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_name_uq" ON "leave_types" USING btree (lower("name"));