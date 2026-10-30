CREATE TABLE "etl_id_map" (
	"entity" text NOT NULL,
	"old_id" text NOT NULL,
	"new_id" uuid NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "etl_id_map_entity_old_id_pk" PRIMARY KEY("entity","old_id")
);
--> statement-breakpoint
CREATE TABLE "etl_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"dry_run" boolean NOT NULL,
	"loaders" text[] NOT NULL,
	"status" text NOT NULL,
	"written" integer DEFAULT 0 NOT NULL,
	"rejected" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text
);
