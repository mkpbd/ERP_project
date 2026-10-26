ALTER TABLE "hospital_patients" DROP CONSTRAINT "hospital_patients_mobile_ck";--> statement-breakpoint
ALTER TABLE "hospital_patients" ALTER COLUMN "mobile_no" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "hospital_patients_contact_mobile_idx" ON "hospital_patients" USING btree ("contact_mobile_no");--> statement-breakpoint
ALTER TABLE "hospital_patients" ADD CONSTRAINT "hospital_patients_phone_ck" CHECK ("hospital_patients"."mobile_no" is not null or "hospital_patients"."contact_mobile_no" is not null);--> statement-breakpoint
ALTER TABLE "hospital_patients" ADD CONSTRAINT "hospital_patients_mobile_ck" CHECK ("hospital_patients"."mobile_no" is null or "hospital_patients"."mobile_no" ~ '^01[3-9][0-9]{8}$');