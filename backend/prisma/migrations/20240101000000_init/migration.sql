-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('initiated', 'processing', 'completed', 'failed', 'reversed');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('debit', 'credit', 'reversal_credit', 'fx_fee');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('received', 'processed', 'failed', 'ignored');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "business_name" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "locked_balance" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "account_balances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "balance_non_negative" CHECK (balance >= 0),
    CONSTRAINT "locked_balance_non_negative" CHECK (locked_balance >= 0)
);

-- CreateTable
CREATE TABLE "fx_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_currency" CHAR(3) NOT NULL,
    "destination_currency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,8) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fx_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "idempotency_key" VARCHAR(255) NOT NULL,
    "response_status" INTEGER NOT NULL,
    "response_body" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" VARCHAR(50) NOT NULL,
    "sender_account_id" UUID NOT NULL,
    "recipient_name" VARCHAR(255) NOT NULL,
    "recipient_country" CHAR(2) NOT NULL,
    "recipient_currency" CHAR(3) NOT NULL,
    "source_currency" CHAR(3) NOT NULL,
    "source_amount" DECIMAL(20,6) NOT NULL,
    "destination_amount" DECIMAL(20,6) NOT NULL,
    "fx_rate" DECIMAL(20,8) NOT NULL,
    "fx_quote_id" UUID,
    "status" "TransactionStatus" NOT NULL DEFAULT 'initiated',
    "provider_reference" VARCHAR(255),
    "idempotency_key" VARCHAR(255),
    "failure_reason" TEXT,
    "initiated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "failed_at" TIMESTAMPTZ(6),
    "reversed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "source_amount_positive" CHECK (source_amount > 0),
    CONSTRAINT "destination_amount_positive" CHECK (destination_amount > 0)
);

-- CreateTable
CREATE TABLE "transaction_status_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transaction_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "entry_type" "LedgerEntryType" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_reference" VARCHAR(255),
    "raw_headers" JSONB NOT NULL,
    "raw_body" TEXT NOT NULL,
    "signature" VARCHAR(512),
    "processing_status" "WebhookProcessingStatus" NOT NULL DEFAULT 'received',
    "processing_error" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "account_balances_account_id_currency_key" ON "account_balances"("account_id", "currency");

-- CreateIndex
CREATE INDEX "fx_quotes_expires_at_idx" ON "fx_quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_idempotency_key_key" ON "idempotency_keys"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_reference_key" ON "transactions"("reference");

-- CreateIndex
CREATE INDEX "transactions_status_idx" ON "transactions"("status");

-- CreateIndex
CREATE INDEX "transactions_sender_account_id_idx" ON "transactions"("sender_account_id");

-- CreateIndex
CREATE INDEX "transactions_provider_reference_idx" ON "transactions"("provider_reference");

-- CreateIndex
CREATE INDEX "transactions_created_at_idx" ON "transactions"("created_at" DESC);

-- CreateIndex
CREATE INDEX "transaction_status_history_transaction_id_idx" ON "transaction_status_history"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_idx" ON "ledger_entries"("account_id");

-- CreateIndex
CREATE INDEX "webhook_events_provider_reference_idx" ON "webhook_events"("provider_reference");

-- CreateIndex
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sender_account_id_fkey"
    FOREIGN KEY ("sender_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fx_quote_id_fkey"
    FOREIGN KEY ("fx_quote_id") REFERENCES "fx_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transaction_status_history" ADD CONSTRAINT "transaction_status_history_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey"
    FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
