
import mysql from 'mysql2/promise';

async function tryConnect(user: string, pass: string) {
  console.log(`Trying ${user} / "${pass}"...`);
  try {
    const conn = await mysql.createConnection({
      host: '127.0.0.1',
      user: user,
      password: pass,
    });
    console.log(`SUCCESS: Connected as ${user}`);
    await conn.end();
    return true;
  } catch (err: any) {
    console.log(`FAILED: ${err.message}`);
    return false;
  }
}

async function main() {
  if (await tryConnect('root', '')) process.exit(0);
  if (await tryConnect('root', 'root')) process.exit(0);
  if (await tryConnect('root', '1234')) process.exit(0);
  console.log('All attempts failed.');
  process.exit(1);
}

main();
