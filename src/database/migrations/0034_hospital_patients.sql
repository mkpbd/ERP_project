CREATE TABLE "hospital_sequences" (
	"kind" text NOT NULL,
	"year" smallint NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "hospital_sequences_kind_year_pk" PRIMARY KEY("kind","year")
);
--> statement-breakpoint
CREATE TABLE "hospital_patient_photos" (
	"patient_id" uuid PRIMARY KEY NOT NULL,
	"content_type" text NOT NULL,
	"data" "bytea" NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "hospital_patient_photos_type_ck" CHECK ("hospital_patient_photos"."content_type" in ('image/png', 'image/jpeg', 'image/webp')),
	CONSTRAINT "hospital_patient_photos_size_ck" CHECK (octet_length("hospital_patient_photos"."data") between 1 and 1048576)
);
--> statement-breakpoint
CREATE TABLE "hospital_patients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"uhid" bigint NOT NULL,
	"title" text,
	"full_name" text NOT NULL,
	"sex" text NOT NULL,
	"date_of_birth" date NOT NULL,
	"birth_estimated" boolean DEFAULT false NOT NULL,
	"blood_group" text,
	"marital_status" text,
	"religion" text,
	"occupation" text,
	"father_name" text,
	"mother_name" text,
	"spouse_name" text,
	"mobile_no" text NOT NULL,
	"email" text,
	"id_type" text,
	"id_no" text,
	"care_of" text,
	"house_no" text,
	"road_no" text,
	"village" text,
	"post_office" text,
	"area" text,
	"district_id" uuid,
	"contact_name" text,
	"contact_relation" text,
	"contact_mobile_no" text,
	"contact_address" text,
	"special_alert" text,
	"confidential" boolean DEFAULT false NOT NULL,
	"registered_on" date NOT NULL,
	"registered_by" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"inactive_reason" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hospital_patients_uhid_ck" CHECK ("hospital_patients"."uhid" > 0),
	CONSTRAINT "hospital_patients_mobile_ck" CHECK ("hospital_patients"."mobile_no" ~ '^01[3-9][0-9]{8}$'),
	CONSTRAINT "hospital_patients_name_ck" CHECK (char_length("hospital_patients"."full_name") between 1 and 150),
	CONSTRAINT "hospital_patients_id_ck" CHECK (("hospital_patients"."id_type" is null) = ("hospital_patients"."id_no" is null)),
	CONSTRAINT "hospital_patients_inactive_ck" CHECK ("hospital_patients"."is_active" or "hospital_patients"."inactive_reason" is not null)
);
--> statement-breakpoint
ALTER TABLE "hospital_patient_photos" ADD CONSTRAINT "hospital_patient_photos_patient_id_hospital_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."hospital_patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_patient_photos" ADD CONSTRAINT "hospital_patient_photos_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_patients" ADD CONSTRAINT "hospital_patients_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hospital_patients" ADD CONSTRAINT "hospital_patients_registered_by_users_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_patients_uhid_uq" ON "hospital_patients" USING btree ("uhid");--> statement-breakpoint
CREATE INDEX "hospital_patients_mobile_idx" ON "hospital_patients" USING btree ("mobile_no");--> statement-breakpoint
CREATE INDEX "hospital_patients_name_idx" ON "hospital_patients" USING btree (lower("full_name"));--> statement-breakpoint
CREATE INDEX "hospital_patients_registered_idx" ON "hospital_patients" USING btree ("registered_on");--> statement-breakpoint
CREATE UNIQUE INDEX "hospital_patients_id_document_uq" ON "hospital_patients" USING btree ("id_type","id_no") WHERE "hospital_patients"."is_active" and "hospital_patients"."id_no" is not null;