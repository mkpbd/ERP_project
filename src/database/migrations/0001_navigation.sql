CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"path" text,
	"display_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"icon" text,
	"landing_page_icon_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "menus_not_own_parent_ck" CHECK ("menus"."parent_id" <> "menus"."id"),
	CONSTRAINT "menus_name_len_ck" CHECK (char_length("menus"."name") between 1 and 100),
	CONSTRAINT "menus_path_format_ck" CHECK ("menus"."path" = lower("menus"."path") and "menus"."path" like '/_%'),
	CONSTRAINT "menus_display_order_ck" CHECK ("menus"."display_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "role_menus" (
	"role_id" uuid NOT NULL,
	"menu_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "role_menus_pk" PRIMARY KEY("role_id","menu_id")
);
--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_parent_id_menus_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."menus"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_menus" ADD CONSTRAINT "role_menus_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menus_parent_idx" ON "menus" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "menus_path_idx" ON "menus" USING btree ("path");--> statement-breakpoint
CREATE INDEX "role_menus_menu_idx" ON "role_menus" USING btree ("menu_id");