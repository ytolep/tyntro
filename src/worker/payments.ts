import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '@/lib/db';
import { withAccountLock } from '@/lib/db/lock';
import { getPaymentsConfig } from '@/lib/payments/config';
import { verifyUsdcTransfer, type ParsedTransaction, type SolanaRpc } from '@/lib/payments/solanaPay';
import { computeRulesHash } from '@/lib/payments/purchase';

export const PURCHASE_EXPIRE_MS = 30 * 60 * 1000;

/**
 * Один цикл проверки оплат: для каждой PENDING-покупки ищет транзакцию по её
 * reference-ключу; верный перевод USDC → PAID + TradingAccount + DEPOSIT
 * в одной транзакции (идемпотентно), без перевода и старше 30 минут → EXPIRED.
 * Транзакция найдена — подтверждаем даже с опозданием: полученные деньги не теряем.
 */
export async function checkPendingPayments(deps: { rpc: SolanaRpc }): Promise<{ paid: number; expired: number }> {
  const cfg = getPaymentsConfig();
  const pending = await db.purchase.findMany({ where: { status: 'PENDING' }, include: { challenge: true } });
  let paid = 0;
  let expired = 0;
  for (const purchase of pending) {
    let signature: string | null = null;
    try {
      signature = await findVerifiedSignature(
        deps.rpc,
        purchase.reference,
        purchase.amountUsdc,
        cfg.treasuryWallet,
        cfg.usdcMint,
      );
    } catch (error) {
      // RPC недоступен — покупку не трогаем, попробуем на следующем цикле.
      console.error(JSON.stringify({ level: 'error', msg: 'payment rpc error', purchaseId: purchase.id, error: String(error) }));
      continue;
    }
    if (signature) {
      if (await confirmPurchase(purchase.id, signature)) paid++;
    } else if (Date.now() - purchase.createdAt.getTime() > PURCHASE_EXPIRE_MS) {
      const res = await db.purchase.updateMany({
        where: { id: purchase.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      expired += res.count;
    }
  }
  if (paid || expired) console.log(JSON.stringify({ level: 'info', msg: 'payments cycle', paid, expired }));
  return { paid, expired };
}

/** Первая транзакция по reference, в которой подтверждён перевод ≥ amount на ATA казны. */
async function findVerifiedSignature(
  rpc: SolanaRpc,
  reference: string,
  amount: Decimal,
  treasury: string,
  mint: string,
): Promise<string | null> {
  const signatures = await rpc.getSignaturesForAddress(reference);
  for (const { signature } of signatures) {
    const tx: ParsedTransaction | null = await rpc.getParsedTransaction(signature);
    // Список сигнатур получен через getSignaturesForAddress(reference), но транзакция
    // обязана нести reference этой покупки и среди ключей аккаунтов (H1).
    if (tx && verifyUsdcTransfer(tx, { treasury, splToken: mint, expectedAmount: amount, reference }))
      return signature;
  }
  return null;
}

/**
 * PAID + TradingAccount (CHALLENGE/ACTIVE, балансы = accountSize) + DEPOSIT-проводка;
 * идемпотентно. Одна on-chain транзакция подтверждает максимум одну покупку (H1):
 * подпись, использованная другой покупкой, отвергается — покупка остаётся PENDING
 * (без счёта) и истекает по таймауту.
 */
async function confirmPurchase(purchaseId: string, txSignature: string): Promise<boolean> {
  try {
    return await withAccountLock(`purchase:${purchaseId}`, async (tx) => {
      const purchase = await tx.purchase.findUnique({ where: { id: purchaseId }, include: { challenge: true } });
      if (!purchase || purchase.status !== 'PENDING') return false;

      // Подпись уже потрачена другой покупкой. При гонке двух подтверждений
      // (разные advisory-локи) добивает уникальный индекс Purchase.txSignature.
      const usedBy = await tx.purchase.findFirst({
        where: { txSignature, id: { not: purchaseId } },
        select: { id: true },
      });
      if (usedBy) return false;

      const size = purchase.challenge.accountSize;
      const account = await tx.tradingAccount.create({
        data: {
          userId: purchase.userId,
          challengeId: purchase.challengeId,
          mode: 'CHALLENGE',
          phase: 'CHALLENGE',
          status: 'ACTIVE',
          rulesHash: computeRulesHash(purchase.challenge),
          accountSize: size,
          currentBalance: size,
          currentEquity: size,
          dayStartEquity: size,
          staticMaxDdFloor: size.times(1 - purchase.challenge.maxDdPct / 100),
          dailyDdFloor: size.times(1 - purchase.challenge.dailyDdPct / 100),
        },
      });
      // Инвариант §5: баланс счёта равен сумме проводок — DEPOSIT на весь accountSize.
      await tx.ledgerEntry.create({
        data: { accountId: account.id, type: 'DEPOSIT', amount: size, refId: purchase.id },
      });
      await tx.purchase.update({
        where: { id: purchase.id },
        data: { status: 'PAID', txSignature, accountId: account.id },
      });
      console.log(JSON.stringify({ level: 'info', msg: 'purchase confirmed', purchaseId: purchase.id, accountId: account.id }));
      return true;
    });
  } catch (error) {
    // Уникальный конфликт по txSignature при гонке: транзакция БД откатилась
    // (счёт и проводка не созданы), покупка остаётся PENDING.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
    throw error;
  }
}
