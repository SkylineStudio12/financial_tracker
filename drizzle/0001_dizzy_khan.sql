CREATE TYPE "public"."account_owner" AS ENUM('greg', 'andra');--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "owner" "account_owner";