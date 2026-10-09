import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { db } from '@/lib/db';
import { withAccountLock } from '@/lib/db/lock';
import { notify } from '@/lib/notifications';

/**
 * Funded-стадия и выплаты.
 *
 * Все суммы — Prisma.Decimal. Каждое изменение счёта идёт под withAccountLock,
 * каждое действие пишется в AuditLog.
 */

/** Ошибка домена: status — HTTP-код ответа API. */
export class PayoutError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'PayoutError';
  }
}

type Tx = Prisma.TransactionClient;

type FundedAccount = Prisma.TradingAccountGetPayload<{
  include: { challenge: true; positions: { where: { status: 'OPEN' } } };
}>;

/** Минимум полей счёта для расчёта доступного; FundedAccount ему удовлетворяет. */
interface AvailabilityAccount {
  id: string;
  currentBalance: Decimal;
  accountSize: Decimal;
  challenge: { profitSplitPct: number };
  positions: { unrealizedPnl: Decimal }[];
}

/** Статусы, резервирующие доступную долю; REJECTED ничего не резервирует. */
const RESERVING_STATUSES = ['REQUESTED', 'APPROVED', 'PAID'] as const;

export interface Availability {
  equity: Decimal;
  traderShare: Decimal;
  reserved: Decimal;
  available: Decimal;
}

/**
 * ФОРМУЛА ДОСТУПНОГО К ВЫПЛАТЕ (см. ТЗ агента G):
 *
 *   equity      = currentBalance + Σ unrealizedPnl открытых позиций
 *   profitBase  = max(0, equity − accountSize)
 *   traderShare = profitBase × profitSplitPct / 100
 *   reserved    = Σ Payout(status ∈ REQUESTED|APPROVED|PAID).amountUsd
 *   available   = max(0, traderShare − reserved)
 *
 * Выплачивать можно только со счётов phase = FUNDED_SIM без открытых позиций.
 * PAID-выплаты уже уменьшили баланс проводкой PAYOUT, но по-прежнему вычитаются
 * из доли — консервативная трактовка ТЗ («минус уже запрошенные/выплаченные»):
 * после частичной выплаты остаток доли доступен после нового роста equity.
 */
async function availabilityFor(
  tx: Tx,
  account: AvailabilityAccount,
): Promise<Availability> {
  const openPnl = account.positions.reduce((sum, p) => sum.plus(p.unrealizedPnl), new Decimal(0));
  const equity = (account.currentBalance as Decimal).plus(openPnl);
  const profitBase = Decimal.max(0, equity.minus(account.accountSize as Decimal));
  const split = new Decimal(account.challenge.profitSplitPct.toString());
  const traderShare = profitBase.mul(split).div(100);
  const reservedRow = await tx.payout.aggregate({
    _sum: { amountUsd: true },
    where: { accountId: account.id, status: { in: [...RESERVING_STATUSES] } },
  });
  const reserved = reservedRow._sum.amountUsd ?? new Decimal(0);
  return { equity, traderShare, reserved, available: Decimal.max(0, traderShare.minus(reserved)) };
}

/** Сумма клиента: положительная, не больше двух знаков после точки. */
export function parsePayoutAmount(input: unknown): Decimal {
  if (typeof input !== 'string' && typeof input !== 'number')
    throw new PayoutError(400, 'amount must be a number');
  let value: Decimal;
  try {
    value = new Decimal(input);
  } catch {
    throw new PayoutError(400, 'Invalid amount');
  }
  if (!value.isFinite() || value.lte(0)) throw new PayoutError(400, 'Amount must be positive');
  if (!value.eq(value.toDecimalPlaces(2, Decimal.ROUND_DOWN)))
    throw new PayoutError(400, 'Amount must be given in whole cents');
  return value;
}

// ---------------------------------------------------------------------------
// Funded: одобрение / отклонение / запрос трейдером
// ---------------------------------------------------------------------------

/**
 * Одобрение админом: PASSED-челлендж → НОВЫЙ счёт phase FUNDED_SIM, mode CHALLENGE
 * (исполнение симулированное), status ACTIVE, те же правила (rulesHash) и размер,
 * ledger DEPOSIT на accountSize. Связь со старым счётом — AuditLog FUNDED_APPROVED.
 * Старый счёт остаётся PASSED. Идемпотентность: повторный approve того же счёта → 409.
 */
export async function approveFundedAccount(adminId: string, accountId: string): Promise<string> {
  return withAccountLock(accountId, async (tx) => {
    const source = await tx.tradingAccount.findUnique({ where: { id: accountId }, include: { challenge: true } });
    if (!source) throw new PayoutError(404, 'Account not found');
    if (source.phase !== 'CHALLENGE' || source.status !== 'PASSED')
      throw new PayoutError(409, 'Only a PASSED challenge account can be approved for funded');
    const already = await tx.auditLog.findFirst({ where: { action: 'FUNDED_APPROVED', targetId: accountId } });
    if (already) throw new PayoutError(409, 'Funded account is already approved for this challenge account');

    const size = source.accountSize as Decimal;
    const funded = await tx.tradingAccount.create({
      data: {
        userId: source.userId,
        challengeId: source.challengeId,
        mode: 'CHALLENGE', // FUNDED_SIM — фаза, а не режим: исполнение остаётся симуляцией
        phase: 'FUNDED_SIM',
        status: 'ACTIVE',
        rulesHash: source.rulesHash,
        accountSize: size,
        currentBalance: size,
        currentEquity: size,
        dayStartEquity: size,
        staticMaxDdFloor: size.mul(100 - source.challenge.maxDdPct).div(100),
        dailyDdFloor: size.mul(100 - source.challenge.dailyDdPct).div(100),
      },
    });
    // Инвариант §5: баланс = сумма проводок → DEPOSIT на весь accountSize.
    await tx.ledgerEntry.create({
      data: { accountId: funded.id, type: 'DEPOSIT', amount: size, refId: source.id },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: 'FUNDED_APPROVED',
        targetId: source.id,
        data: { sourceAccountId: source.id, fundedAccountId: funded.id, rulesHash: source.rulesHash },
      },
    });
    await notify(tx, {
      userId: source.userId,
      kind: 'FUNDED_APPROVED',
      title: 'Funded account approved',
      body: `Your passed challenge is approved: a new $${size.toFixed(0)} funded (simulated) account is live with a ${source.challenge.profitSplitPct}% profit split.`,
      accountId: funded.id,
    });
    return funded.id;
  });
}

/** Отклонение админом: только AuditLog FUNDED_REJECTED, счёт не меняется. */
export async function rejectFundedAccount(adminId: string, accountId: string, reason?: string): Promise<void> {
  const source = await db.tradingAccount.findUnique({ where: { id: accountId } });
  if (!source) throw new PayoutError(404, 'Account not found');
  if (source.phase !== 'CHALLENGE' || source.status !== 'PASSED')
    throw new PayoutError(409, 'Only a PASSED challenge account can be rejected');
  const already = await db.auditLog.findFirst({ where: { action: 'FUNDED_APPROVED', targetId: accountId } });
  if (already) throw new PayoutError(409, 'Funded account is already approved for this challenge account');
  await db.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: 'FUNDED_REJECTED',
        targetId: accountId,
        data: reason ? { reason } : {},
      },
    });
    await notify(tx, {
      userId: source.userId,
      kind: 'FUNDED_REJECTED',
      title: 'Funded request rejected',
      body: reason ? `Your funded request was rejected: ${reason}` : 'Your funded request was rejected.',
      accountId,
    });
  });
}

/**
 * Запрос трейдером активации funded (кнопка «Запросить funded» на /funded):
 * AuditLog FUNDED_REQUESTED. Идемпотентен: повторный запрос → duplicate: true.
 */
export async function requestFundedReview(userId: string, accountId: string): Promise<{ requested: true; duplicate: boolean }> {
  const account = await db.tradingAccount.findUnique({ where: { id: accountId } });
  if (!account || account.userId !== userId) throw new PayoutError(404, 'Account not found');
  if (account.phase !== 'CHALLENGE' || account.status !== 'PASSED')
    throw new PayoutError(409, 'Only a PASSED challenge account can request funded review');
  const approved = await db.auditLog.findFirst({ where: { action: 'FUNDED_APPROVED', targetId: accountId } });
  if (approved) throw new PayoutError(409, 'Funded account is already approved for this challenge account');
  const existing = await db.auditLog.findFirst({ where: { action: 'FUNDED_REQUESTED', targetId: accountId } });
  if (existing) return { requested: true, duplicate: true };
  await db.auditLog.create({
    data: { actorId: userId, action: 'FUNDED_REQUESTED', targetId: accountId, data: {} },
  });
  return { requested: true, duplicate: false };
}

// ---------------------------------------------------------------------------
// Выплаты
// ---------------------------------------------------------------------------

/** POST /api/payouts/request: проверки и создание Payout REQUESTED. */
export async function requestPayout(
  userId: string,
  accountId: string,
  amountInput: unknown,
): Promise<{ payoutId: string; availableUsd: string }> {
  const amount = parsePayoutAmount(amountInput);
  return withAccountLock(accountId, async (tx) => {
    const account = (await tx.tradingAccount.findUnique({
      where: { id: accountId },
      include: { challenge: true, positions: { where: { status: 'OPEN' } } },
    })) as FundedAccount | null;
    if (!account || account.userId !== userId) throw new PayoutError(404, 'Account not found');
    if (account.phase !== 'FUNDED_SIM')
      throw new PayoutError(400, 'Payouts are available only on funded accounts (phase FUNDED_SIM)');
    if (account.status !== 'ACTIVE') throw new PayoutError(409, `Funded account is ${account.status}`);
    if (account.positions.length > 0)
      throw new PayoutError(409, 'Close all open positions before requesting a payout');

    const { available } = await availabilityFor(tx, account);
    if (amount.gt(available))
      throw new PayoutError(400, `Amount exceeds available for payout: ${available.toFixed(2)} USDC`);

    const payout = await tx.payout.create({ data: { accountId, amountUsd: amount, status: 'REQUESTED' } });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        action: 'PAYOUT_REQUESTED',
        targetId: payout.id,
        data: { accountId, amountUsd: amount.toFixed(2) },
      },
    });
    return { payoutId: payout.id, availableUsd: available.minus(amount).toFixed(2) };
  });
}

/**
 * POST /api/admin/payouts/decide {payoutId, approve, txSignature?}:
 *   approve=false                          → REJECTED
 *   approve=true,  без txSignature         → APPROVED
 *   approve=true,  с txSignature           → PAID (перевод USDC уже сделан админом вручную)
 *
 * ФОРМУЛА СПИСАНИЯ ПРИ PAID (задана ТЗ агента G):
 *   списание = amountUsd × 100 / profitSplitPct   — полная прибыль, соответствующая
 *   доле трейдера, а не только доля трейдера. Проводка ledger PAYOUT = −списание,
 *   баланс/equity/dayStartEquity уменьшаются на списание, поэтому при выплате всей
 *   доступной доли счёт возвращается ровно к accountSize (доля фирмы остаётся в счёте).
 *   dayStartEquity сдвигается вместе со списанием: выплата — не торговый убыток
 *   и не должна пробивать дневной floor.
 */
export async function decidePayout(
  adminId: string,
  payoutId: string,
  approve: boolean,
  txSignature?: string,
): Promise<{ id: string; status: string }> {
  if (txSignature !== undefined && (typeof txSignature !== 'string' || txSignature.trim().length === 0))
    throw new PayoutError(400, 'txSignature must be a non-empty string');
  const signature = typeof txSignature === 'string' ? txSignature.trim() : undefined;

  const existing = await db.payout.findUnique({ where: { id: payoutId }, select: { accountId: true } });
  if (!existing) throw new PayoutError(404, 'Payout not found');

  return withAccountLock(existing.accountId, async (tx) => {
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
    const decidedAt = new Date();

    if (!approve) {
      if (payout.status !== 'REQUESTED' && payout.status !== 'APPROVED')
        throw new PayoutError(409, `Payout is already ${payout.status}`);
      await tx.payout.update({ where: { id: payoutId }, data: { status: 'REJECTED', approvedBy: adminId, decidedAt } });
      await tx.auditLog.create({
        data: { actorId: adminId, action: 'PAYOUT_REJECTED', targetId: payoutId, data: { accountId: payout.accountId } },
      });
      const owner = await tx.tradingAccount.findUnique({ where: { id: payout.accountId }, select: { userId: true } });
      if (owner)
        await notify(tx, {
          userId: owner.userId,
          kind: 'PAYOUT_REJECTED',
          title: 'Payout rejected',
          body: `Your payout request of ${(payout.amountUsd as Decimal).toFixed(2)} USDC was rejected.`,
          accountId: payout.accountId,
        });
      return { id: payoutId, status: 'REJECTED' };
    }

    if (payout.status === 'APPROVED' && !signature)
      throw new PayoutError(409, 'Payout is already approved; provide txSignature to mark it paid');
    if (payout.status !== 'REQUESTED' && payout.status !== 'APPROVED')
      throw new PayoutError(409, `Payout is already ${payout.status}`);

    if (!signature) {
      await tx.payout.update({ where: { id: payoutId }, data: { status: 'APPROVED', approvedBy: adminId, decidedAt } });
      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'PAYOUT_APPROVED',
          targetId: payoutId,
          data: { accountId: payout.accountId, amountUsd: payout.amountUsd.toFixed(2) },
        },
      });
      const owner = await tx.tradingAccount.findUnique({ where: { id: payout.accountId }, select: { userId: true } });
      if (owner)
        await notify(tx, {
          userId: owner.userId,
          kind: 'PAYOUT_APPROVED',
          title: 'Payout approved',
          body: `Your payout of ${(payout.amountUsd as Decimal).toFixed(2)} USDC is approved and will be sent to your wallet shortly.`,
          accountId: payout.accountId,
        });
      return { id: payoutId, status: 'APPROVED' };
    }

    // PAID: перевод уже выполнен админом вручную — сверяем условия на свежих данных.
    const account = (await tx.tradingAccount.findUnique({
      where: { id: payout.accountId },
      include: { challenge: true, positions: { where: { status: 'OPEN' } } },
    })) as FundedAccount | null;
    if (!account) throw new PayoutError(404, 'Account not found');
    if (account.phase !== 'FUNDED_SIM')
      throw new PayoutError(409, 'Payouts are available only on funded accounts (phase FUNDED_SIM)');
    if (account.status !== 'ACTIVE') throw new PayoutError(409, `Funded account is ${account.status}`);
    if (account.positions.length > 0)
      throw new PayoutError(409, 'Account has open positions; payout cannot be finalized');

    const { traderShare, reserved } = await availabilityFor(tx, account); // reserved включает эту выплату
    if (traderShare.lt(reserved))
      throw new PayoutError(409, 'Account equity no longer covers the requested payouts');

    const split = new Decimal(account.challenge.profitSplitPct.toString());
    const deduction = (payout.amountUsd as Decimal).mul(100).div(split).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
    const balanceAfter = (account.currentBalance as Decimal).minus(deduction);
    if (balanceAfter.lt(account.accountSize as Decimal))
      throw new PayoutError(409, 'Payout would bring the balance below the account size');

    await tx.ledgerEntry.create({
      data: { accountId: account.id, type: 'PAYOUT', amount: deduction.neg(), refId: payout.id },
    });
    await tx.tradingAccount.update({
      where: { id: account.id },
      data: {
        currentBalance: balanceAfter,
        currentEquity: balanceAfter, // открытых позиций нет → equity = баланс
        dayStartEquity: { decrement: deduction },
      },
    });
    await tx.payout.update({
      where: { id: payoutId },
      data: { status: 'PAID', txSignature: signature, approvedBy: adminId, decidedAt },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        action: 'PAYOUT_PAID',
        targetId: payoutId,
        data: {
          accountId: account.id,
          amountUsd: payout.amountUsd.toFixed(2),
          deductedFromBalance: deduction.toFixed(2),
          txSignature: signature,
        },
      },
    });
    await notify(tx, {
      userId: account.userId,
      kind: 'PAYOUT_PAID',
      title: 'Payout sent',
      body: `Your payout of ${(payout.amountUsd as Decimal).toFixed(2)} USDC has been sent. Transaction: ${signature}`,
      accountId: account.id,
    });
    return { id: payoutId, status: 'PAID' };
  });
}

// ---------------------------------------------------------------------------
// Обзор для /profile и /funded
// ---------------------------------------------------------------------------

export interface PayoutOverview {
  walletAddress: string;
  accounts: Array<{
    id: string;
    planType: string;
    status: string;
    phase: string;
    accountSize: string;
    equity: string;
    availableUsd: string;
    profitSplitPct: number;
    openPositions: number;
    canRequest: boolean;
  }>;
  payouts: Array<{
    id: string;
    accountId: string;
    amountUsd: string;
    status: string;
    txSignature: string | null;
    createdAt: string;
  }>;
  /** accountId со статусом «запрос funded отправлен, решения ещё нет». */
  fundRequestAccountIds: string[];
}

export async function payoutOverview(userId: string): Promise<PayoutOverview> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const accounts = await db.tradingAccount.findMany({
    where: { userId, phase: 'FUNDED_SIM' },
    include: { challenge: true, positions: { where: { status: 'OPEN' } } },
    orderBy: { createdAt: 'desc' },
  });
  const payouts = await db.payout.findMany({
    where: { account: { userId } },
    orderBy: { timestamp: 'desc' },
    take: 50,
  });

  // Запросы funded-активации без решения: FUNDED_REQUESTED есть, FUNDED_APPROVED нет.
  const [requested, approved] = await Promise.all([
    db.auditLog.findMany({ where: { action: 'FUNDED_REQUESTED', actorId: userId }, select: { targetId: true } }),
    db.auditLog.findMany({ where: { action: 'FUNDED_APPROVED' }, select: { targetId: true } }),
  ]);
  const approvedSet = new Set(approved.flatMap((a) => (a.targetId ? [a.targetId] : [])));
  const fundRequestAccountIds = [...new Set(requested.flatMap((a) => (a.targetId ? [a.targetId] : [])))].filter(
    (id) => !approvedSet.has(id),
  );

  const accountRows = [] as PayoutOverview['accounts'];
  for (const account of accounts) {
    const { equity, available } = await availabilityFor(db, account);
    accountRows.push({
      id: account.id,
      planType: account.challenge.planType,
      status: account.status,
      phase: account.phase,
      accountSize: (account.accountSize as Decimal).toFixed(2),
      equity: equity.toFixed(2),
      availableUsd: available.toFixed(2),
      profitSplitPct: account.challenge.profitSplitPct,
      openPositions: account.positions.length,
      canRequest: account.status === 'ACTIVE' && account.positions.length === 0 && available.gt(0),
    });
  }

  return {
    walletAddress: user.walletAddress,
    accounts: accountRows,
    payouts: payouts.map((p) => ({
      id: p.id,
      accountId: p.accountId,
      amountUsd: (p.amountUsd as Decimal).toFixed(2),
      status: p.status,
      txSignature: p.txSignature,
      createdAt: p.timestamp.toISOString(),
    })),
    fundRequestAccountIds,
  };
}
