CREATE TABLE "marketing_areas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"zone_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_doctors" (
	"doctor_id" uuid PRIMARY KEY NOT NULL,
	"officer_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_people" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"phone" text,
	"parent_id" uuid,
	"zone_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_people_parent_ck" CHECK (("marketing_people"."kind" = 'manager') = ("marketing_people"."parent_id" is null)),
	CONSTRAINT "marketing_people_zone_ck" CHECK ("marketing_people"."zone_id" is null or "marketing_people"."kind" = 'officer')
);
--> statement-breakpoint
CREATE TABLE "marketing_targets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"officer_id" uuid,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "marketing_targets_month_ck" CHECK ("marketing_targets"."month" between 1 and 12 and "marketing_targets"."year" between 2000 and 2100),
	CONSTRAINT "marketing_targets_amount_ck" CHECK ("marketing_targets"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "marketing_zones" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "marketing_areas" ADD CONSTRAINT "marketing_areas_zone_id_marketing_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."marketing_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_doctors" ADD CONSTRAINT "marketing_doctors_doctor_id_hospital_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."hospital_doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_doctors" ADD CONSTRAINT "marketing_doctors_officer_id_marketing_people_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."marketing_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_people" ADD CONSTRAINT "marketing_people_parent_id_marketing_people_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."marketing_people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_people" ADD CONSTRAINT "marketing_people_zone_id_marketing_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."marketing_zones"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_targets" ADD CONSTRAINT "marketing_targets_officer_id_marketing_people_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."marketing_people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_areas_name_uq" ON "marketing_areas" USING btree ("zone_id",lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_people_code_uq" ON "marketing_people" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "marketing_people_parent_idx" ON "marketing_people" USING btree ("parent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_targets_uq" ON "marketing_targets" USING btree (coalesce("officer_id", '00000000-0000-0000-0000-000000000000'::uuid),"year","month");--> statement-breakpoint
CREATE UNIQUE INDEX "marketing_zones_name_uq" ON "marketing_zones" USING btree (lower("name"));