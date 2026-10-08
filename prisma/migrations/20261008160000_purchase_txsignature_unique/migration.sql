-- H1 (docs/REVIEW.md): одна on-chain транзакция подтверждает максимум одну покупку.
-- NULL у PENDING-покупок не конфликтуют (Postgres допускает много NULL в UNIQUE).

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_txSignature_key" ON "Purchase"("txSignature");
