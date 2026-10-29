CREATE TABLE "nutrition_category_meals" (
	"bed_category_id" uuid NOT NULL,
	"meal_type_id" uuid NOT NULL,
	CONSTRAINT "nutrition_category_meals_bed_category_id_meal_type_id_pk" PRIMARY KEY("bed_category_id","meal_type_id")
);
--> statement-breakpoint
CREATE TABLE "nutrition_diet_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"plan_id" uuid,
	"nil_by_mouth" boolean NOT NULL,
	"remarks" text,
	"from_at" timestamp with time zone NOT NULL,
	"to_at" timestamp with time zone,
	"ordered_by" uuid NOT NULL,
	"ended_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_diet_orders_plan_ck" CHECK ("nutrition_diet_orders"."nil_by_mouth" = ("nutrition_diet_orders"."plan_id" is null))
);
--> statement-breakpoint
CREATE TABLE "nutrition_diet_plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_meal_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admission_id" uuid NOT NULL,
	"diet_order_id" uuid NOT NULL,
	"meal_type_id" uuid NOT NULL,
	"service_day" date NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"served_by" uuid NOT NULL,
	"served_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nutrition_meal_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"served_at" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nutrition_meal_types_time_ck" CHECK ("nutrition_meal_types"."served_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
--> statement-breakpoint
CREATE TABLE "nutrition_plan_menus" (
	"plan_id" uuid NOT NULL,
	"meal_type_id" uuid NOT NULL,
	"menu" text NOT NULL,
	CONSTRAINT "nutrition_plan_menus_plan_id_meal_type_id_pk" PRIMARY KEY("plan_id","meal_type_id")
);
--> statement-breakpoint
ALTER TABLE "nutrition_category_meals" ADD CONSTRAINT "nutrition_category_meals_bed_category_id_hospital_bed_categories_id_fk" FOREIGN KEY ("bed_category_id") REFERENCES "public"."hospital_bed_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_category_meals" ADD CONSTRAINT "nutrition_category_meals_meal_type_id_nutrition_meal_types_id_fk" FOREIGN KEY ("meal_type_id") REFERENCES "public"."nutrition_meal_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_diet_orders" ADD CONSTRAINT "nutrition_diet_orders_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_diet_orders" ADD CONSTRAINT "nutrition_diet_orders_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_diet_orders" ADD CONSTRAINT "nutrition_diet_orders_plan_id_nutrition_diet_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."nutrition_diet_plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_diet_orders" ADD CONSTRAINT "nutrition_diet_orders_ordered_by_users_id_fk" FOREIGN KEY ("ordered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_diet_orders" ADD CONSTRAINT "nutrition_diet_orders_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_meal_services" ADD CONSTRAINT "nutrition_meal_services_admission_id_hospital_admissions_id_fk" FOREIGN KEY ("admission_id") REFERENCES "public"."hospital_admissions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_meal_services" ADD CONSTRAINT "nutrition_meal_services_diet_order_id_nutrition_diet_orders_id_fk" FOREIGN KEY ("diet_order_id") REFERENCES "public"."nutrition_diet_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_meal_services" ADD CONSTRAINT "nutrition_meal_services_meal_type_id_nutrition_meal_types_id_fk" FOREIGN KEY ("meal_type_id") REFERENCES "public"."nutrition_meal_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_meal_services" ADD CONSTRAINT "nutrition_meal_services_served_by_users_id_fk" FOREIGN KEY ("served_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_plan_menus" ADD CONSTRAINT "nutrition_plan_menus_plan_id_nutrition_diet_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."nutrition_diet_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nutrition_plan_menus" ADD CONSTRAINT "nutrition_plan_menus_meal_type_id_nutrition_meal_types_id_fk" FOREIGN KEY ("meal_type_id") REFERENCES "public"."nutrition_meal_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "nutrition_diet_orders_admission_idx" ON "nutrition_diet_orders" USING btree ("admission_id","from_at");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_diet_orders_current_uq" ON "nutrition_diet_orders" USING btree ("admission_id") WHERE "nutrition_diet_orders"."to_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_diet_plans_name_uq" ON "nutrition_diet_plans" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_meal_services_uq" ON "nutrition_meal_services" USING btree ("admission_id","meal_type_id","service_day");--> statement-breakpoint
CREATE UNIQUE INDEX "nutrition_meal_types_name_uq" ON "nutrition_meal_types" USING btree (lower("name"));