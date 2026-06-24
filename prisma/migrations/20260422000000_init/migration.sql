-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "ClassificationType" AS ENUM ('TYPE_1', 'TYPE_2', 'TYPE_3', 'TYPE_4', 'UNCAT');

-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "IngestionJobType" AS ENUM ('INGEST_SEARCH', 'INGEST_ORDERS', 'INGEST_PRODUCTS');

-- CreateTable
CREATE TABLE "stores" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "access_token" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3),
    "scope" TEXT NOT NULL,
    "plan" "Plan" NOT NULL DEFAULT 'FREE',
    "aov_cents" INTEGER,
    "currency" TEXT,
    "timezone" TEXT,
    "merchant_email" TEXT,
    "order_sample_size" INTEGER,
    "insufficient_aov" BOOLEAN NOT NULL DEFAULT false,
    "industry" TEXT,
    "category" TEXT,
    "first_dashboard_view_at" TIMESTAMP(3),
    "digest_opted_out_at" TIMESTAMP(3),
    "digest_last_sent_at" TIMESTAMP(3),
    "grace_ends_at" TIMESTAMP(3),
    "shopify_charge_id" TEXT,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalled_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_product_sync" TIMESTAMP(3),
    "last_order_sync" TIMESTAMP(3),
    "last_search_sync" TIMESTAMP(3),
    "scheduled_redact_at" TIMESTAMP(3),

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "job_type" "IngestionJobType" NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'PENDING',
    "progress_pct" INTEGER NOT NULL DEFAULT 0,
    "progress_total" INTEGER,
    "progress_done" INTEGER,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error_message" TEXT,
    "bull_job_id" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_queries" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "query_normalized" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "date_bucket" DATE NOT NULL,
    "result_count" INTEGER NOT NULL,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "filters_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog_products" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "shopify_product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT,
    "product_type" TEXT,
    "vendor" TEXT,
    "tags" TEXT[],
    "description" TEXT,
    "description_text" TEXT,
    "variants_json" JSONB,
    "options_json" JSONB,
    "status" TEXT,
    "embedding_text" TEXT,
    "embedding" vector(384),
    "shopify_updated_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "catalog_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classifications" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "query_norm" TEXT NOT NULL,
    "type" "ClassificationType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "matched_product_ids" TEXT[],
    "occurrence_count" INTEGER NOT NULL DEFAULT 0,
    "low_volume" BOOLEAN NOT NULL DEFAULT false,
    "reasoning" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_estimates" (
    "id" TEXT NOT NULL,
    "classification_id" TEXT NOT NULL,
    "monthly_volume" INTEGER NOT NULL,
    "aov_cents" INTEGER NOT NULL,
    "benchmark_pct" DOUBLE PRECISION NOT NULL,
    "estimate_cents" INTEGER NOT NULL,
    "band_low_cents" INTEGER NOT NULL,
    "band_high_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "synonyms_applied" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_title" TEXT,
    "similarity" DOUBLE PRECISION,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shopify_synonym_id" TEXT,
    "source" TEXT NOT NULL,
    "undoes_id" TEXT,
    "estimated_impact_cents" INTEGER,

    CONSTRAINT "synonyms_applied_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digest_log" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gap_count" INTEGER NOT NULL,
    "estimated_value_cents" INTEGER NOT NULL,
    "opened_at" TIMESTAMP(3),

    CONSTRAINT "digest_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_events" (
    "id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "shopify_charge_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "store_id" TEXT,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stores_shop_domain_key" ON "stores"("shop_domain");

-- CreateIndex
CREATE INDEX "ingestion_runs_store_id_job_type_created_at_idx" ON "ingestion_runs"("store_id", "job_type", "created_at");

-- CreateIndex
CREATE INDEX "ingestion_runs_status_idx" ON "ingestion_runs"("status");

-- CreateIndex
CREATE INDEX "search_queries_store_id_occurred_at_idx" ON "search_queries"("store_id", "occurred_at");

-- CreateIndex
CREATE INDEX "search_queries_store_id_query_normalized_idx" ON "search_queries"("store_id", "query_normalized");

-- CreateIndex
CREATE UNIQUE INDEX "search_queries_store_id_query_normalized_date_bucket_key" ON "search_queries"("store_id", "query_normalized", "date_bucket");

-- CreateIndex
CREATE INDEX "catalog_products_store_id_synced_at_idx" ON "catalog_products"("store_id", "synced_at");

-- CreateIndex
CREATE UNIQUE INDEX "catalog_products_store_id_shopify_product_id_key" ON "catalog_products"("store_id", "shopify_product_id");

-- CreateIndex
CREATE INDEX "classifications_store_id_type_idx" ON "classifications"("store_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "classifications_store_id_query_norm_key" ON "classifications"("store_id", "query_norm");

-- CreateIndex
CREATE INDEX "revenue_estimates_classification_id_idx" ON "revenue_estimates"("classification_id");

-- CreateIndex
CREATE INDEX "synonyms_applied_store_id_applied_at_idx" ON "synonyms_applied"("store_id", "applied_at");

-- CreateIndex
CREATE INDEX "digest_log_store_id_sent_at_idx" ON "digest_log"("store_id", "sent_at");

-- CreateIndex
CREATE INDEX "billing_events_store_id_created_at_idx" ON "billing_events"("store_id", "created_at");

-- CreateIndex
CREATE INDEX "feature_flags_key_idx" ON "feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_store_id_key_key" ON "feature_flags"("store_id", "key");

-- AddForeignKey
ALTER TABLE "ingestion_runs" ADD CONSTRAINT "ingestion_runs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_queries" ADD CONSTRAINT "search_queries_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog_products" ADD CONSTRAINT "catalog_products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classifications" ADD CONSTRAINT "classifications_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_estimates" ADD CONSTRAINT "revenue_estimates_classification_id_fkey" FOREIGN KEY ("classification_id") REFERENCES "classifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "synonyms_applied" ADD CONSTRAINT "synonyms_applied_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digest_log" ADD CONSTRAINT "digest_log_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

