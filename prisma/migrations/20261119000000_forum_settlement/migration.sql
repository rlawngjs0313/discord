-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "settlement_posts" (
    "post_id" TEXT NOT NULL,
    "guild_id" TEXT NOT NULL,
    "forum_id" TEXT NOT NULL,

    CONSTRAINT "settlement_posts_pkey" PRIMARY KEY ("post_id")
);

-- CreateTable
CREATE TABLE "settlement_records" (
    "record_id" UUID NOT NULL,
    "post_id" TEXT NOT NULL,
    "creator_id" TEXT NOT NULL,
    "create_interaction_id" TEXT NOT NULL,
    "total_won" BIGINT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),

    CONSTRAINT "settlement_records_pkey" PRIMARY KEY ("record_id")
);

-- CreateTable
CREATE TABLE "settlement_shares" (
    "record_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "share_won" BIGINT NOT NULL,

    CONSTRAINT "settlement_shares_pkey" PRIMARY KEY ("record_id","user_id")
);

-- CreateTable
CREATE TABLE "user_bank_accounts" (
    "user_id" TEXT NOT NULL,
    "bank_code" TEXT NOT NULL,
    "formatted_account_number" TEXT NOT NULL,
    "account_holder" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_bank_accounts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "private_responses" (
    "response_id" UUID NOT NULL,
    "interaction_id" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "post_id" TEXT,
    "scope_post_id" TEXT,
    "command_kind" TEXT NOT NULL,
    "encrypted_token" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_delete_at" TIMESTAMPTZ(3) NOT NULL,
    "token_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'active',

    CONSTRAINT "private_responses_pkey" PRIMARY KEY ("response_id")
);

-- CreateTable
CREATE TABLE "private_response_accounts" (
    "response_id" UUID NOT NULL,
    "account_user_id" TEXT NOT NULL,

    CONSTRAINT "private_response_accounts_pkey" PRIMARY KEY ("response_id","account_user_id")
);

-- CreateTable
CREATE TABLE "private_response_records" (
    "response_id" UUID NOT NULL,
    "record_id" UUID NOT NULL,

    CONSTRAINT "private_response_records_pkey" PRIMARY KEY ("response_id","record_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "settlement_records_create_interaction_id_key" ON "settlement_records"("create_interaction_id");

-- CreateIndex
CREATE INDEX "settlement_records_post_id_created_at_record_id_idx" ON "settlement_records"("post_id", "created_at" DESC, "record_id" DESC);

-- CreateIndex
CREATE INDEX "settlement_shares_user_id_record_id_idx" ON "settlement_shares"("user_id", "record_id");

-- CreateIndex
CREATE UNIQUE INDEX "private_responses_interaction_id_key" ON "private_responses"("interaction_id");

-- CreateIndex
CREATE INDEX "private_responses_scope_post_id_owner_id_command_kind_idx" ON "private_responses"("scope_post_id", "owner_id", "command_kind");

-- CreateIndex
CREATE INDEX "private_responses_token_expires_at_idx" ON "private_responses"("token_expires_at");

-- CreateIndex
CREATE INDEX "private_response_accounts_account_user_id_response_id_idx" ON "private_response_accounts"("account_user_id", "response_id");

-- CreateIndex
CREATE INDEX "private_response_records_record_id_response_id_idx" ON "private_response_records"("record_id", "response_id");

-- AddForeignKey
ALTER TABLE "settlement_records" ADD CONSTRAINT "settlement_records_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "settlement_posts"("post_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_shares" ADD CONSTRAINT "settlement_shares_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "settlement_records"("record_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_responses" ADD CONSTRAINT "private_responses_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "settlement_posts"("post_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_response_accounts" ADD CONSTRAINT "private_response_accounts_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "private_responses"("response_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_response_records" ADD CONSTRAINT "private_response_records_response_id_fkey" FOREIGN KEY ("response_id") REFERENCES "private_responses"("response_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_response_records" ADD CONSTRAINT "private_response_records_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "settlement_records"("record_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "settlement_records"
  ADD CONSTRAINT "settlement_total_positive" CHECK ("total_won" BETWEEN 1 AND 999999999999999);
ALTER TABLE "settlement_shares"
  ADD CONSTRAINT "settlement_share_nonnegative" CHECK ("share_won" >= 0);
ALTER TABLE "private_responses"
  ADD CONSTRAINT "private_response_state" CHECK ("state" IN ('active', 'invalidated', 'deleted', 'expired'));

-- Both the normal expiry and invalidation use the same job key. A rollback
-- discards the scheduled job along with the response or the mutation.
CREATE FUNCTION schedule_private_response_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  delete_at timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    delete_at := NEW.scheduled_delete_at;
  ELSIF OLD.state = 'active' AND NEW.state = 'invalidated' THEN
    delete_at := clock_timestamp();
  ELSE
    RETURN NEW;
  END IF;

  PERFORM graphile_worker.add_job(
    'delete_private_response',
    json_build_object('response_id', NEW.response_id),
    run_at := delete_at,
    max_attempts := 8,
    job_key := 'private-reply:' || NEW.response_id::text,
    job_key_mode := 'replace'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER private_response_delete_job
AFTER INSERT OR UPDATE OF state ON private_responses
FOR EACH ROW EXECUTE FUNCTION schedule_private_response_delete();
