import { createServer } from 'node:http';
import { randomBytes, scrypt as deriveKey, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const [admin, script, css, seed] = await Promise.all(
  ['admin/admin.html', 'admin/admin.js', 'admin/admin.css', 'default-content.json']
    .map((name) => readFile(join(root, name), 'utf8'))
);
const defaults = JSON.parse(seed);
const scrypt = promisify(deriveKey);
const mediaTypes = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp',
  gif:'image/gif', avif:'image/avif', pdf:'application/pdf', svg:'image/svg+xml' };
const assets = new Map([['site.css','text/css'], ...['site.js','tailwind-config.js','content-defaults.js'].map((name) => [name,'text/javascript'])]);
const initial = { revision: 0, published: defaults, draft: defaults };
const categories = ['Семинары', 'Объявления', 'События'];
const text = (value, limit = 4000) => {
  if (typeof value !== 'string' || value.length > limit) throw new Error('Проверьте длину и формат полей.');
  return value.trim();
};

const requiredFields = {
  news: ['title', 'Заголовок', 'Новости и семинары'],
  documents: ['title', 'Заголовок', 'Документы'],
  faq: ['q', 'Вопрос', 'FAQ'],
  courses: ['title', 'Заголовок', 'Учебные курсы'],
  faculty: ['name', 'ФИО', 'Преподаватели'],
  leaders: ['name', 'ФИО', 'Руководители']
};

export function validate(input) {
  if (!input || typeof input !== 'object') throw new Error('Некорректные данные.');
  const result = { contacts: {} };
  for (const key of Object.keys(defaults.contacts)) result.contacts[key] = text(input.contacts?.[key], 1000);
  if (result.contacts.email && !/^[^\s@?&#]+@[^\s@?&#]+\.[^\s@?&#]+$/.test(result.contacts.email)) {
    throw new Error('Проверьте адрес электронной почты.');
  }
  for (const [collection, [requiredKey, fieldLabel, sectionLabel]] of Object.entries(requiredFields)) {
    const rows = input[collection];
    if (!Array.isArray(rows) || rows.length > 200) throw new Error('В каждом списке допускается до 200 записей.');
    const ids = new Set();
    result[collection] = rows.map((row, index) => {
      const values = {};
      for (const [key, sample] of Object.entries(defaults[collection][0])) {
        values[key] = Array.isArray(sample)
          ? validateLines(row?.[key])
          : text(row?.[key], key === 'fullText' ? 12000 : 4000);
      }
      if (!values[requiredKey]) {
        throw new Error(`Раздел «${sectionLabel}», запись № ${index + 1}. Заполните поле «${fieldLabel}» или удалите пустую запись.`);
      }
      if ('id' in values) {
        if (!/^[a-z\d-]{1,64}$/i.test(values.id) || ids.has(values.id)) throw new Error('Повторяющийся или неверный ID.');
        ids.add(values.id);
      }
      if (collection === 'news' && !categories.includes(values.category)) throw new Error('Выберите категорию новости.');
      if (collection === 'faculty' && !defaults.faculty.some((person) => person.accent === values.accent)) {
        throw new Error('Неверное оформление карточки преподавателя.');
      }
      if (collection === 'courses' && (!values.categories.length ||
          values.categories.some((key) => !['mandatory', 'special', 'seminars', 'year12', 'year34'].includes(key)))) {
        throw new Error('Выберите хотя бы одну вкладку учебного плана.');
      }
      if (values.url && !validDocument(values.url)) throw new Error('Для документа укажите HTTPS-ссылку или путь от корня сайта.');
      return values;
    });
  }
  return result;
}

function validateLines(value) {
  if (!Array.isArray(value) || value.length > 50) throw new Error('В одном поле списка допускается до 50 строк.');
  return value.map((line) => text(line, 1000)).filter(Boolean);
}

function validDocument(value) {
  try {
    const url = new URL(value, 'https://site.invalid');
    return !url.username && !url.password &&
      (/^https:\/\//i.test(value) || (/^\/[^/\\]/.test(value) && url.origin === 'https://site.invalid'));
  } catch {
    return false;
  }
}

async function servePage(res, path, type) {
  try {
    const body = await readFile(join(root, 'site', path));
    return send(res, 200, body, type);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return send(res, 404, 'Страница не найдена.');
  }
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function send(res, status, body, type = 'text/plain', headers = {}) {
  res.writeHead(status, {
    'Content-Type': type.startsWith('text/') || type === 'application/json' ? type + '; charset=utf-8' : type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    ...headers
  });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data), 'application/json');
}

async function readBody(req, limit) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > limit) throw Object.assign(new Error('Превышен размер запроса.'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function loginPage(message = '') {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Вход в админку</title><link rel="stylesheet" href="/admin/admin.css">
  <main class="login"><p><a href="/">К сайту</a></p><h1>Вход в админку</h1>
  <form method="post" action="/admin/login"><label>Логин<input required name="username" autocomplete="username" maxlength="32"></label><label>Пароль<input required type="password" name="password" autocomplete="current-password" maxlength="256"></label>
  ${message ? `<p role="alert">${escape(message)}</p>` : ''}<button class="primary">Войти</button></form></main></html>`;
}

export async function createApp({ accounts, origin, dataDir }) {
  if (!Array.isArray(accounts) || accounts.length === 0) throw new Error('Добавьте хотя бы одну учётную запись командой npm run account.');
  const users = new Map();
  for (const account of accounts) {
    if (!account || !/^[a-z0-9][a-z0-9_-]{1,31}$/.test(account.username) ||
        !['editor', 'publisher'].includes(account.role) || !/^[0-9a-f]{32}$/.test(account.salt) ||
        !/^[0-9a-f]{128}$/.test(account.hash) || users.has(account.username)) {
      throw new Error('Проверьте файл accounts.json.');
    }
    users.set(account.username, account);
  }
  const fakeSalt = randomBytes(16).toString('hex');
  const fakeHash = randomBytes(64);
  const url = new URL(origin);
  if (url.origin !== origin || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) {
    throw new Error('Задайте SITE_ORIGIN: HTTPS-адрес сайта без завершающего слеша или локальный HTTP-адрес.');
  }
  const secure = url.protocol === 'https:' ? '; Secure' : '';
  const cookieName = secure ? '__Host-fmmp-session' : 'fmmp-session';
  const cookie = (value, age) => `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure}`;
  const sessions = new Map();
  let loginAttempts = [];
  function session(req) {
    const token = (req.headers.cookie || '').split(/; */).find((item) => item.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    const active = sessions.get(token);
    if (!active || active.expires <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return { ...active, token };
  }

  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'content.json');
  let state = initial;
  try {
    const stored = JSON.parse(await readFile(file, 'utf8'));
    if (!Number.isSafeInteger(stored.revision) || stored.revision < 0) throw new Error('Некорректная версия данных.');
    state = { revision: stored.revision, draft: validate({...defaults, ...stored.draft}),
      published: validate({...defaults, ...stored.published}), updatedBy: stored.updatedBy, updatedAt: stored.updatedAt };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  let pending = Promise.resolve();
  function commit(revision, content, publish, username) {
    const operation = pending.then(async () => {
      if (revision !== state.revision) return null;
      const next = { revision: revision + 1, draft: content, published: publish ? content : state.published,
        updatedBy: username, updatedAt: new Date().toISOString() };
      const temporary = file + '.' + randomBytes(8).toString('hex') + '.tmp';
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx', flush: true });
        await rename(temporary, file);
      } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
      }
      state = next;
      return next;
    });
    pending = operation.catch(() => {});
    return operation;
  }

  const adminHeaders = { 'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };
  const html = (res, status, body, headers = {}) => send(res, status, body, 'text/html', { ...adminHeaders, ...headers });
  return async (req, res) => {
    const { pathname } = new URL(req.url, origin);
    const method = req.method;
    if (method === 'GET' && ['/','/index.html'].includes(pathname)) return servePage(res, 'index.html', 'text/html');
    if (method === 'GET' && /^\/pages\/[a-z0-9][a-z0-9-]*\.html$/.test(pathname)) return servePage(res, pathname.slice(1), 'text/html');
    if (method === 'GET' && pathname.startsWith('/assets/') && assets.has(pathname.slice(8))) {
      return servePage(res, pathname.slice(1), assets.get(pathname.slice(8)));
    }
    const media = pathname.match(/^\/media\/[a-z0-9][a-z0-9_-]*\.(png|jpg|jpeg|webp|gif|avif|pdf|svg)$/i);
    if (method === 'GET' && media) return servePage(res, pathname.slice(1), mediaTypes[media[1].toLowerCase()]);
    if (method === 'GET' && pathname === '/api/content') return json(res, 200, state.published);
    if (method === 'GET' && pathname === '/admin/admin.js') return send(res, 200, script, 'text/javascript');
    if (method === 'GET' && pathname === '/admin/admin.css') return send(res, 200, css, 'text/css');
    if (method === 'POST' && req.headers.origin !== origin) return send(res, 403, 'Недопустимый источник запроса.');
    const active = session(req);
    if (method === 'POST' && pathname === '/admin/login') {
      const form = new URLSearchParams(await readBody(req, 4096));
      const now = Date.now();
      loginAttempts = loginAttempts.filter((attempt) => now - attempt < 60_000);
      if (loginAttempts.length >= 20) return html(res, 429, loginPage('Слишком много попыток. Повторите через минуту.'), { 'Retry-After':'60' });
      loginAttempts.push(now);
      const username = (form.get('username') || '').trim().toLowerCase();
      const input = form.get('password') || '';
      const account = users.get(username);
      const derived = await scrypt(input.slice(0, 256), account?.salt || fakeSalt, 64);
      const matched = timingSafeEqual(derived, account ? Buffer.from(account.hash, 'hex') : fakeHash);
      if (!matched || !account || input.length > 256) return html(res, 401, loginPage('Неверный логин или пароль.'));
      for (const [token, value] of sessions) if (value.expires <= now) sessions.delete(token);
      if (active) sessions.delete(active.token);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { username, role: account.role, expires: now + 8 * 3_600_000 });
      return send(res, 303, '', 'text/plain', { Location:'/admin/', 'Set-Cookie':cookie(token, 28_800) });
    }
    if (method === 'POST' && pathname === '/admin/logout') {
      if (active) sessions.delete(active.token);
      return send(res, 303, '', 'text/plain', { Location:'/admin/', 'Set-Cookie':cookie('',0) });
    }
    if (method === 'GET' && ['/admin','/admin/'].includes(pathname)) return html(res, 200, active ? admin : loginPage());
    if (method === 'GET' && pathname === '/admin/api/preview') {
      return active ? json(res, 200, state.draft) : json(res, 401, { error: 'Войдите в админку.' });
    }
    if (pathname === '/admin/content' && ['GET','POST'].includes(method)) {
      if (!active) return json(res, 401, { error:'Войдите в админку.' });
      if (method === 'GET') return json(res, 200, { revision:state.revision, content:state.draft, username:active.username, canPublish:active.role === 'publisher', updatedBy:state.updatedBy, updatedAt:state.updatedAt });
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') return json(res, 415, { error:'Ожидается JSON.' });
      const body = await readBody(req, 2 * 1024 * 1024);
      let payload;
      let content;
      try {
        payload = JSON.parse(body);
        if (typeof payload?.publish !== 'boolean') throw new Error('Выберите тип сохранения.');
        content = validate(payload.content);
      } catch (error) {
        return json(res, 400, { error:error.message });
      }
      if (payload.publish && active.role !== 'publisher') return json(res, 403, { error: 'У вашей учётной записи нет права публикации.' });
      const saved = await commit(payload.revision, content, payload.publish, active.username);
      if (!saved) return json(res, 409, { error:'Коллега или другая вкладка уже сохранили новые данные. Перед обновлением страницы скопируйте нужные правки.' });
      return json(res, 200, { revision:saved.revision, content:saved.draft });
    }
    return send(res, 404, 'Страница не найдена.');
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const { SITE_ORIGIN, DATA_DIR, HOST, ACCOUNTS_FILE } = process.env;
  const accountsPath = resolve(ACCOUNTS_FILE || join(root, 'accounts.json'));
  const accounts = JSON.parse(await readFile(accountsPath, 'utf8'));
  const handler = await createApp({
    accounts, origin: SITE_ORIGIN || `http://localhost:${port}`,
    dataDir: resolve(DATA_DIR || join(root, 'data'))
  });
  createServer((req, res) => {
    handler(req, res).catch((error) => {
      if (error.status !== 413) console.error(error);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Ошибка сервера.' });
      else res.destroy();
    });
  }).listen(port, HOST || '127.0.0.1', () => console.log('Сервер запущен на порту ' + port));
}
