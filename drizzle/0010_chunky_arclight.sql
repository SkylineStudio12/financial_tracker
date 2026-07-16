CREATE TABLE "salary_transaction_details" (
	"transaction_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"personal_deduction_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_transaction_details_transaction_id_revision_pk" PRIMARY KEY("transaction_id","revision"),
	CONSTRAINT "salary_transaction_details_deduction_nonnegative_check" CHECK ("salary_transaction_details"."personal_deduction_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "salary_transaction_details" ADD CONSTRAINT "salary_transaction_details_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;