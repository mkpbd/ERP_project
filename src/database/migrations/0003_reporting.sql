CREATE TABLE "role_reports" (
	"role_id" uuid NOT NULL,
	"report_key" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "role_reports_pk" PRIMARY KEY("role_id","report_key"),
	CONSTRAINT "role_reports_key_format_ck" CHECK ("role_reports"."report_key" ~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$')
);
--> statement-breakpoint
ALTER TABLE "role_reports" ADD CONSTRAINT "role_reports_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_reports" ADD CONSTRAINT "role_reports_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "role_reports_report_idx" ON "role_reports" USING btree ("report_key");