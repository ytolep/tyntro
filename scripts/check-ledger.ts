// Агент K «Нагрузка»: сверка ledger и инвариантов после прогона bot-load.
// Использование: DATABASE_URL=... node --import tsx scripts/check-ledger.ts
// Проверки:
//   1) currentBalance == Σ LedgerEntry (допуск 1e-9)
//   2) currentEquity == currentBalance + Σ unrealizedPnl открытых позиций (1e-9)
//   3) нет открытых позиций у FAILED/PASSED
//   4) нет двух ордеров с одним idempotencyKey
//   5) нет отрицательных quantity (Order.size, Fill.quantity, Position.quantity)
// Выход: сводка; код процесса 0 при нуле нарушений, иначе 1.
import { db } from '../src/lib/db';
import { Decimal } from '@prisma/client/runtime/library';

const TOL = new Decimal('0.000000001');

interface Violation { check: string; detail: string }

async function main(): Promise<void> {
  const accounts = await db.tradingAccount.findMany({
    select: { id: true, status: true, currentBalance: true, currentEquity: true },
  });
  const ledgerSums = new Map(
    (await db.ledgerEntry.groupBy({ by: ['accountId'], _sum: { amount: true } }))
      .map((r) => [r.accountId, r._sum.amount ?? new Decimal(0)]),
  );
  const unrealSums = new Map(
    (await db.position.groupBy({ by: ['accountId'], where: { status: 'OPEN' }, _sum: { unrealizedPnl: true } }))
      .map((r) => [r.accountId, r._sum.unrealizedPnl ?? new Decimal(0)]),
  );

  const violations: Violation[] = [];
  const add = (check: string, detail: string) => violations.push({ check, detail });

  for (const acc of accounts) {
    const balance = acc.currentBalance as Decimal;
    const equity = acc.currentEquity as Decimal;
    const ledgerSum = ledgerSums.get(acc.id) ?? new Decimal(0);
    if (balance.sub(ledgerSum).abs().gt(TOL))
      add('balance != Σ ledger', `account ${acc.id}: balance ${balance.toFixed(12)} vs Σ ${ledgerSum.toFixed(12)} (Δ ${(balance.sub(ledgerSum)).toFixed(12)})`);
    const unrealSum = unrealSums.get(acc.id) ?? new Decimal(0);
    if (equity.sub(balance.add(unrealSum)).abs().gt(TOL))
      add('equity != balance + Σ unrealized', `account ${acc.id}: equity ${equity.toFixed(12)} vs ${balance.add(unrealSum).toFixed(12)}`);
  }

  const posOnFinal = await db.position.count({
    where: { status: 'OPEN', account: { status: { in: ['FAILED', 'PASSED'] } } },
  });
  if (posOnFinal > 0) add('open positions on FAILED/PASSED', `${posOnFinal} позиций`);

  const dupKeys = await db.$queryRaw<{ idempotencyKey: string; n: number }[]>`
    SELECT "idempotencyKey", COUNT(*)::int AS n FROM "Order"
    WHERE "idempotencyKey" IS NOT NULL
    GROUP BY "idempotencyKey" HAVING COUNT(*) > 1`;
  if (dupKeys.length > 0)
    add('duplicate idempotencyKey', dupKeys.slice(0, 10).map((r) => `${r.idempotencyKey}×${r.n}`).join(', ') + (dupKeys.length > 10 ? ' …' : ''));

  const negOrder = await db.order.count({ where: { size: { lt: 0 } } });
  const negFill = await db.fill.count({ where: { quantity: { lt: 0 } } });
  const negPos = await db.position.count({ where: { quantity: { lt: 0 } } });
  if (negOrder + negFill + negPos > 0)
    add('negative quantity', `orders ${negOrder}, fills ${negFill}, positions ${negPos}`);

  // ---- Сводка ----
  const fills = await db.fill.count();
  const statuses = await db.tradingAccount.groupBy({ by: ['status'], _count: { _all: true } });
  const byStatus = Object.fromEntries(statuses.map((s) => [s.status, s._count._all]));
  console.log('=== check-ledger ===');
  console.log(`Счетов: ${accounts.length}`);
  console.log(`Сделок (fills): ${fills}`);
  console.log(`FAILED: ${byStatus['FAILED'] ?? 0}, PASSED: ${byStatus['PASSED'] ?? 0}`);
  console.log(`Статусы: ${statuses.map((s) => `${s.status}=${s._count._all}`).join(', ')}`);
  console.log(`Нарушений: ${violations.length}`);
  if (violations.length > 0) {
    const byCheck = new Map<string, number>();
    for (const v of violations) byCheck.set(v.check, (byCheck.get(v.check) ?? 0) + 1);
    for (const [check, n] of byCheck) console.log(`  [${check}] × ${n}`);
    for (const v of violations.slice(0, 20)) console.log(`    ${v.check}: ${v.detail}`);
    if (violations.length > 20) console.log(`    … и ещё ${violations.length - 20}`);
  }
  await db.$disconnect();
  process.exitCode = violations.length === 0 ? 0 : 1;
}

main().catch(async (e) => {
  console.error('check-ledger упал:', e);
  await db.$disconnect().catch(() => {});
  process.exit(1);
});
