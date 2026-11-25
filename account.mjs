import { randomBytes, scryptSync } from 'node:crypto';
import { readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const [username, role = 'publisher'] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(username || '') || !['publisher', 'editor'].includes(role)) {
  throw new Error('Формат: npm run account -- username publisher|editor');
}
const file = resolve(process.env.ACCOUNTS_FILE || 'accounts.json');
let accounts = [];
try {
  accounts = JSON.parse(await readFile(file, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (accounts.some((account) => account.username === username)) throw new Error('Такой логин уже есть.');
const password = randomBytes(24).toString('base64url');
const salt = randomBytes(16).toString('hex');
const hash = scryptSync(password, salt, 64).toString('hex');
accounts.push({username, role, salt, hash});
const temporary = file + '.tmp';
await writeFile(temporary, JSON.stringify(accounts, null, 2) + '\n', {mode:0o600, flag:'wx'});
try {
  await rename(temporary, file);
} catch (error) {
  await unlink(temporary).catch(() => {});
  throw error;
}
console.log('Логин: ' + username);
console.log('Пароль: ' + password);
console.log('Сохраните пароль. Сервер хранит только хеш. Перезапустите сервер, если он уже работает.');
