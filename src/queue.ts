import { PgBoss } from 'pg-boss';

const boss = new PgBoss(process.env.DATABASE_URL as string);

boss.on('error', (error: Error) => console.error('pg-boss error:', error));

export async function startBoss() {
  await boss.start();
  console.log('✅ pg-boss started');
}

export default boss;