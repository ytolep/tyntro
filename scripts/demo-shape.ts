/**
 * Доводит демо-базу до состояния, где видны все экраны продукта.
 * Только для демо: отказывается работать, если в DATABASE_URL нет "demo".
 *
 *   DATABASE_URL=postgresql://props:props@localhost:54339/props_test_demo \
 *   DEMO_ADMIN_WALLET=<адрес админа> npx tsx scripts/demo-shape.ts
 *
 * Сначала bot-load создаёт счета и сделки через настоящий код исполнения и воркера.
 * Этот скрипт добавляет то, что за минуты торговли не наступает само:
 *  - три счёта PASSED (баланс до цели проводкой ADJUST с пометкой demo, 3 торговых дня);
 *  - один из них одобрен в funded настоящей функцией approveFundedAccount, на funded
 *    прибыль и запрос выплаты через requestPayout (KYC не пройден — видна блокировка);
 *  - второй ждёт решения по funded в очереди админа.
 */
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { approveFundedAccount, requestFundedReview, requestPayout } from '../src/lib/payouts/service';
import { notify } from '../src/lib/notifications';

const url = process.env.DATABASE_URL ?? '';
if (!url.includes('demo')) throw new Error('Refusing to run: DATABASE_URL must point at a demo database');
const db = new PrismaClient();
const d = (x: Decimal | string | number) => new Decimal(x);

async function adjustTo(accountId: string, target: Decimal, note: string, extra: Record<string, unknown> = {}) {
  await db.$transaction(async (tx) => {
    const acc = await tx.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    const delta = target.minus(d(acc.currentBalance as Decimal));
    await tx.ledgerEntry.create({ data: { accountId, type: 'ADJUST', amount: delta, refId: `demo:${note}` } });
    await tx.tradingAccount.update({
      where: { id: accountId },
      data: { currentBalance: target, currentEquity: target, ...extra },
    });
  });
}

async function main() {
  const admin = await db.user.findFirst({ where: { role: 'ADMIN' } });
  if (!admin) throw new Error('No ADMIN user in demo DB');

  // Счета ботов без открытых позиций, с наибольшим балансом.
  const flat = await db.tradingAccount.findMany({
    where: { status: 'ACTIVE', phase: 'CHALLENGE', positions: { none: { status: 'OPEN' } }, user: { role: 'USER' } },
    include: { challenge: true },
    orderBy: { currentBalance: 'desc' },
    take: 3,
  });
  if (flat.length < 3) throw new Error(`Need 3 flat active accounts, found ${flat.length}`);

  for (const acc of flat) {
    const target = d(acc.accountSize as Decimal).mul(d(100).plus(d(acc.challenge.profitTargetPct))).div(100).plus(d(acc.accountSize as Decimal).mul('0.004'));
    await adjustTo(acc.id, target, 'passed', { status: 'PASSED', tradingDaysCount: 3 });
    await db.order.updateMany({ where: { accountId: acc.id, status: 'OPEN' }, data: { status: 'CANCELLED' } });
    await db.$transaction((tx) => notify(tx, {
      userId: acc.userId, kind: 'ACCOUNT_PASSED', title: 'Challenge passed!',
      body: 'Profit target reached — your challenge account is PASSED. Request funded activation from the Funded page.',
      accountId: acc.id,
    }));
  }
  console.log(`PASSED: ${flat.length}`);

  // Первый: funded одобрен, прибыль, запрос выплаты (KYC не пройден).
  const [first, second] = flat;
  // Счёт полного пути отдаём реальному тестовому кошельку: в Phantom видно PASSED, funded, выплату.
  const traderWallet = process.env.DEMO_TRADER_WALLET;
  if (traderWallet) {
    const trader = await db.user.upsert({ where: { walletAddress: traderWallet }, update: {}, create: { walletAddress: traderWallet } });
    await db.tradingAccount.update({ where: { id: first.id }, data: { userId: trader.id } });
    await db.notification.updateMany({ where: { accountId: first.id }, data: { userId: trader.id } });
    first.userId = trader.id;
  }
  await requestFundedReview(first.userId, first.id);
  const fundedId = await approveFundedAccount(admin.id, first.id);
  const funded = await db.tradingAccount.findUniqueOrThrow({ where: { id: fundedId } });
  await adjustTo(fundedId, d(funded.accountSize as Decimal).mul('1.04'), 'funded-profit', { tradingDaysCount: 4 });
  const payout = await requestPayout(first.userId, fundedId, '150.00');
  console.log(`funded ${fundedId.slice(0, 8)}, payout requested ${payout.payoutId.slice(0, 8)} (KYC ${payout.kycStatus})`);

  // Второй: ждёт решения по funded.
  await requestFundedReview(second.userId, second.id);
  console.log('funded review pending: 1');
}

main().finally(() => db.$disconnect());
