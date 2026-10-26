CREATE TABLE "hospital_corporate_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_person" text,
	"contact_no" text,
	"address" text,
	"payment" text NOT NULL,
	"credit_limit" numeric(12, 2),
	"discount_percent" numeric(5, 2) DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_corporate_clients_name_ck" CHECK (char_length("hospital_corporate_clients"."name") between 1 and 150),
	CONSTRAINT "hospital_corporate_clients_limit_ck" CHECK ("hospital_corporate_clients"."credit_limit" is null or "hospital_corporate_clients"."credit_limit" >= 0),
	CONSTRAINT "hospital_corporate_clients_discount_ck" CHECK ("hospital_corporate_clients"."discount_percent" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_service_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_service_groups_name_ck" CHECK (char_length("hospital_service_groups"."name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "hospital_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text,
	"name" text NOT NULL,
	"group_id" uuid NOT NULL,
	"rate" numeric(12, 2) NOT NULL,
	"share_percent" numeric(5, 2),
	"is_opd" boolean DEFAULT true NOT NULL,
	"is_ipd" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_services_name_ck" CHECK (char_length("hospital_services"."name") between 1 and 150),
	CONSTRAINT "hospital_services_rate_ck" CHECK ("hospital_services"."rate" >= 0),
	CONSTRAINT "hospital_services_share_ck" CHECK ("hospital_services"."share_percent" is null or "hospital_services"."share_percent" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" DROP CONSTRAINT "hospital_opd_bill_lines_amounts_ck";--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ALTER COLUMN "doctor_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ALTER COLUMN "visit_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ADD COLUMN "qty" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ADD COLUMN "rate" numeric(12, 2);--> statement-breakpoint
-- Consultation lines billed before services: one unit at the fee.
UPDATE "hospital_opd_bill_lines" SET "rate" = "fee";--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ALTER COLUMN "rate" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD COLUMN "corporate_client_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD COLUMN "staff_id" uuid;--> statement-breakpoint
ALTER TABLE "hospital_service_groups" ADD CONSTRAINT "hospital_service_groups_parent_id_hospital_service_groups_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."hospital_service_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_services" ADD CONSTRAINT "hospital_services_group_id_hospital_service_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."hospital_service_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_corporate_clients_name_uq" ON "hospital_corporate_clients" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_service_groups_name_uq" ON "hospital_service_groups" USING btree (coalesce("parent_id"::text, ''),lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_services_code_uq" ON "hospital_services" USING btree (upper("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_services_name_uq" ON "hospital_services" USING btree ("group_id",lower("name"));--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ADD CONSTRAINT "hospital_opd_bill_lines_service_id_hospital_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."hospital_services"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD CONSTRAINT "hospital_opd_bills_corporate_client_id_hospital_corporate_clients_id_fk" FOREIGN KEY ("corporate_client_id") REFERENCES "public"."hospital_corporate_clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD CONSTRAINT "hospital_opd_bills_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hospital_opd_bill_lines_service_idx" ON "hospital_opd_bill_lines" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "hospital_opd_bills_corporate_idx" ON "hospital_opd_bills" USING btree ("corporate_client_id");--> statement-breakpoint
CREATE INDEX "hospital_opd_bills_staff_idx" ON "hospital_opd_bills" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ADD CONSTRAINT "hospital_opd_bill_lines_kind_ck" CHECK (("hospital_opd_bill_lines"."service_id" is null and "hospital_opd_bill_lines"."visit_type" is not null and "hospital_opd_bill_lines"."doctor_id" is not null) or ("hospital_opd_bill_lines"."service_id" is not null and "hospital_opd_bill_lines"."visit_type" is null));--> statement-breakpoint
ALTER TABLE "hospital_opd_bill_lines" ADD CONSTRAINT "hospital_opd_bill_lines_amounts_ck" CHECK ("hospital_opd_bill_lines"."qty" between 1 and 1000 and "hospital_opd_bill_lines"."rate" >= 0 and "hospital_opd_bill_lines"."fee" = round("hospital_opd_bill_lines"."qty" * "hospital_opd_bill_lines"."rate", 2) and "hospital_opd_bill_lines"."share_amount" >= 0 and "hospital_opd_bill_lines"."share_amount" <= "hospital_opd_bill_lines"."fee");--> statement-breakpoint
ALTER TABLE "hospital_opd_bills" ADD CONSTRAINT "hospital_opd_bills_payer_ck" CHECK ("hospital_opd_bills"."corporate_client_id" is null or "hospital_opd_bills"."staff_id" is null);