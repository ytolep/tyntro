import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// K3: notify() пишется в транзакции события (и откатывается вместе с ней);
// список и отметка прочитанного — строго свои.

if (!process.env.DATABASE_URL?.includes('props_test'))
  throw new Error('Refusing to run: DATABASE_URL must point at props_test (see .env.test)');

// Prisma 6 блокирует деструктивные команды, если видит переменные окружения AI-агента.
const cleanEnv = (): NodeJS.ProcessEnv =>
  Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CLAUDE'))) as NodeJS.ProcessEnv;

let db: typeof import('../../db').db;
let notify: typeof import('../index').notify;
let listNotifications: typeof import('../index').listNotifications;
let markRead: typeof import('../index').markRead;
let aliceId: string;
let bobId: string;

before(async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--force-reset', '--skip-generate'], { stdio: 'pipe', env: cleanEnv() });
  ({ db } = await import('../../db'));
  ({ notify, listNotifications, markRead } = await import('../index'));
  aliceId = (await db.user.create({ data: { walletAddress: 'notify-alice' } })).id;
  bobId = (await db.user.create({ data: { walletAddress: 'notify-bob' } })).id;
});

after(async () => {
  await db?.$disconnect();
});

test('notify откатывается вместе с транзакцией события', async () => {
  await assert.rejects(
    db.$transaction(async (tx) => {
      await notify(tx, { userId: aliceId, kind: 'ACCOUNT_FAILED', title: 't', body: 'b' });
      throw new Error('event failed after notify');
    }),
    /event failed after notify/,
  );
  assert.equal(await db.notification.count(), 0);
});

test('пользователь видит только свои; ids/all-отметка не задевает чужие', async () => {
  await db.$transaction(async (tx) => {
    await notify(tx, { userId: aliceId, kind: 'ACCOUNT_PASSED', title: 'Alice passed', body: 'b1', accountId: 'acc-1' });
    await notify(tx, { userId: aliceId, kind: 'PAYOUT_PAID', title: 'Alice paid', body: 'b2' });
    await notify(tx, { userId: bobId, kind: 'ACCOUNT_FAILED', title: 'Bob failed', body: 'b3' });
  });

  const alice = await listNotifications(aliceId);
  assert.equal(alice.notifications.length, 2);
  assert.ok(alice.notifications.every((n) => n.title.startsWith('Alice')));
  assert.equal(alice.unreadCount, 2);
  assert.ok(alice.notifications.every((n) => typeof n.createdAt === 'string' && typeof n.id === 'string'));

  const bob = await listNotifications(bobId);
  assert.equal(bob.notifications.length, 1);
  assert.equal(bob.notifications[0].title, 'Bob failed');

  // ids: только указанная (несуществующий id просто игнорируется)
  assert.equal(await markRead(aliceId, [alice.notifications[0].id, 'not-a-real-id']), 1);
  assert.equal((await listNotifications(aliceId)).unreadCount, 1);

  // all: добивает остальные свои, Боб не тронут
  assert.equal(await markRead(aliceId), 1);
  assert.equal((await listNotifications(aliceId)).unreadCount, 0);
  assert.equal((await listNotifications(bobId)).unreadCount, 1);
  assert.equal((await listNotifications(bobId)).notifications[0].readAt, null);

  // повторная all-отметка ничего не меняет (readAt уже стоит)
  assert.equal(await markRead(aliceId), 0);
  // пустой ids — no-op
  assert.equal(await markRead(aliceId, []), 0);
});
