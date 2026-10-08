import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PRICING_MATRIX, PLAN_CONFIGS, ACCOUNT_SIZES } from '../src/lib/pricingConfig';

type PlanType = keyof typeof PLAN_CONFIGS; // 'SPRINT' | 'CORE' | 'APEX'

const prisma = new PrismaClient();

// Сид: только матрица челленджей и опциональный ADMIN из env.
// Никаких вымышленных пользователей, счетов и сделок.
async function main() {
  for (const size of ACCOUNT_SIZES) {
    for (const planType of ['SPRINT', 'CORE', 'APEX'] as PlanType[]) {
      const config = PLAN_CONFIGS[planType];
      await prisma.challenge.upsert({
        where: { accountSize_planType: { accountSize: new Decimal(size), planType } },
        update: {},
        create: {
          accountSize: new Decimal(size),
          planType,
          profitTargetPct: config.profitTargetPct,
          dailyDdPct: config.dailyDdPct,
          maxDdPct: config.maxDdPct,
          profitSplitPct: config.profitSplitPct,
          priceUsd: new Decimal(PRICING_MATRIX[size][planType]),
          minTradingDays: config.minTradingDays,
        },
      });
    }
  }

  const adminWallet = process.env.ADMIN_WALLET;
  if (adminWallet) {
    await prisma.user.upsert({
      where: { walletAddress: adminWallet },
      update: { role: 'ADMIN' },
      create: { walletAddress: adminWallet, role: 'ADMIN' },
    });
  }

  console.log(`Seeded ${ACCOUNT_SIZES.length * 3} challenges${adminWallet ? ' + 1 admin user' : ''}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
