CREATE TABLE "comm_chat_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid NOT NULL,
	"sender" text NOT NULL,
	"sender_user_id" uuid,
	"text" text NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	CONSTRAINT "comm_chat_messages_sender_ck" CHECK (("comm_chat_messages"."sender" = 'staff') = ("comm_chat_messages"."sender_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "comm_chats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"patient_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"status" text NOT NULL,
	"assigned_to" uuid,
	"started_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone NOT NULL,
	"patient_read_at" timestamp with time zone,
	"staff_read_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"closed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "comm_health_tips" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"title_bn" text,
	"summary" text,
	"summary_bn" text,
	"body" text NOT NULL,
	"body_bn" text,
	"category" text,
	"image_url" text,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"display_order" smallint DEFAULT 0 NOT NULL,
	"publish_from" timestamp with time zone,
	"publish_to" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "comm_health_tips_window_ck" CHECK ("comm_health_tips"."publish_from" is null or "comm_health_tips"."publish_to" is null or "comm_health_tips"."publish_from" < "comm_health_tips"."publish_to"),
	CONSTRAINT "comm_health_tips_image_ck" CHECK ("comm_health_tips"."image_url" is null or "comm_health_tips"."image_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "comm_notice_recipients" (
	"notice_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	CONSTRAINT "comm_notice_recipients_notice_id_user_id_pk" PRIMARY KEY("notice_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "comm_notices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"sent_by" uuid NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"recipients" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comm_chat_messages" ADD CONSTRAINT "comm_chat_messages_chat_id_comm_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."comm_chats"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_chat_messages" ADD CONSTRAINT "comm_chat_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_chats" ADD CONSTRAINT "comm_chats_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_chats" ADD CONSTRAINT "comm_chats_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_chats" ADD CONSTRAINT "comm_chats_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_notice_recipients" ADD CONSTRAINT "comm_notice_recipients_notice_id_comm_notices_id_fk" FOREIGN KEY ("notice_id") REFERENCES "public"."comm_notices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_notice_recipients" ADD CONSTRAINT "comm_notice_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comm_notices" ADD CONSTRAINT "comm_notices_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comm_chat_messages_chat_idx" ON "comm_chat_messages" USING btree ("chat_id","sent_at");--> statement-breakpoint
CREATE INDEX "comm_chats_patient_idx" ON "comm_chats" USING btree ("patient_id","status");--> statement-breakpoint
CREATE INDEX "comm_chats_status_idx" ON "comm_chats" USING btree ("status","last_message_at");--> statement-breakpoint
CREATE INDEX "comm_health_tips_category_idx" ON "comm_health_tips" USING btree ("category");--> statement-breakpoint
CREATE INDEX "comm_notice_recipients_unread_idx" ON "comm_notice_recipients" USING btree ("user_id") WHERE "comm_notice_recipients"."read_at" is null;