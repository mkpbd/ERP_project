CREATE TABLE "duty_exchanges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"exchange_with_staff_id" uuid NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"shift" text,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duty_exchanges_dates_ck" CHECK ("duty_exchanges"."date_to" >= "duty_exchanges"."date_from"),
	CONSTRAINT "duty_exchanges_not_self_ck" CHECK ("duty_exchanges"."staff_id" <> "duty_exchanges"."exchange_with_staff_id")
);
--> statement-breakpoint
CREATE TABLE "extra_duties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"duty_from" date NOT NULL,
	"duty_to" date NOT NULL,
	"compensation_from" date,
	"compensation_to" date,
	"remarks" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extra_duties_dates_ck" CHECK ("extra_duties"."duty_to" >= "extra_duties"."duty_from"),
	CONSTRAINT "extra_duties_compensation_ck" CHECK (("extra_duties"."compensation_from" is null and "extra_duties"."compensation_to" is null) or "extra_duties"."compensation_to" >= "extra_duties"."compensation_from")
);
--> statement-breakpoint
CREATE TABLE "roster_duties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"staff_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"sub_department_id" uuid NOT NULL,
	"duty_date" date NOT NULL,
	"shift_type_id" uuid NOT NULL,
	"code" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"remarks" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roster_duties_interval_ck" CHECK ("roster_duties"."end_at" > "roster_duties"."start_at")
);
--> statement-breakpoint
CREATE TABLE "shift_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"department_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_types_times_ck" CHECK ("shift_types"."start_time" <> "shift_types"."end_time"),
	CONSTRAINT "shift_types_code_len_ck" CHECK (char_length("shift_types"."code") between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "staff_days_off" (
	"staff_id" uuid NOT NULL,
	"off_date" date NOT NULL,
	"remarks" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_days_off_pk" PRIMARY KEY("staff_id","off_date")
);
--> statement-breakpoint
ALTER TABLE "duty_exchanges" ADD CONSTRAINT "duty_exchanges_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duty_exchanges" ADD CONSTRAINT "duty_exchanges_exchange_with_staff_id_staff_records_id_fk" FOREIGN KEY ("exchange_with_staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra_duties" ADD CONSTRAINT "extra_duties_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_duties" ADD CONSTRAINT "roster_duties_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_duties" ADD CONSTRAINT "roster_duties_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_duties" ADD CONSTRAINT "roster_duties_sub_department_id_hr_sub_departments_id_fk" FOREIGN KEY ("sub_department_id") REFERENCES "public"."hr_sub_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_duties" ADD CONSTRAINT "roster_duties_shift_type_id_shift_types_id_fk" FOREIGN KEY ("shift_type_id") REFERENCES "public"."shift_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_duties" ADD CONSTRAINT "roster_duties_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_types" ADD CONSTRAINT "shift_types_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_days_off" ADD CONSTRAINT "staff_days_off_staff_id_staff_records_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_days_off" ADD CONSTRAINT "staff_days_off_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duty_exchanges_staff_idx" ON "duty_exchanges" USING btree ("staff_id","date_from");--> statement-breakpoint
CREATE INDEX "extra_duties_staff_idx" ON "extra_duties" USING btree ("staff_id","duty_from");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_duties_staff_date_shift_uq" ON "roster_duties" USING btree ("staff_id","duty_date","shift_type_id");--> statement-breakpoint
CREATE INDEX "roster_duties_scope_idx" ON "roster_duties" USING btree ("department_id","sub_department_id","duty_date");--> statement-breakpoint
CREATE INDEX "roster_duties_staff_start_idx" ON "roster_duties" USING btree ("staff_id","start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_types_department_code_uq" ON "shift_types" USING btree ("department_id",upper("code"));