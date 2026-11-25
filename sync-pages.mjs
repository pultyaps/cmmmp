import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const site = join(dirname(fileURLToPath(import.meta.url)), 'site');
const index = await readFile(join(site, 'index.html'), 'utf8');
const markers = (name) => new RegExp('(<!-- shared:' + name + ':start -->)[\\s\\S]*?(<!-- shared:' + name + ':end -->)', 'g');
function part(source, name) {
  const portions = Array.from(source.matchAll(markers(name)));
  if (portions.length !== 1) throw new Error('Нужна одна пара комментариев shared:' + name + '.');
  return portions[0][0];
}
function adaptSharedLinks(html) {
  return html.replace(/\b(href|src)=(["'])([^"']+)\2/g, (original, attr, quote, url) => {
    if (url.startsWith('#')) return attr + '=' + quote + '../index.html' + url + quote;
    if (/^(?![a-z]+:|\/|\.\.\/|\?)/i.test(url)) return attr + '=' + quote + '../' + url.replace(/^\.\//,'') + quote;
    return original;
  });
}
const shared = ['header','footer'].map((name) => [name, adaptSharedLinks(part(index, name))]);
const pages = await readdir(join(site, 'pages'), {withFileTypes:true});
for (const page of pages.filter((entry) => entry.isFile() && /^[a-z0-9][a-z0-9-]*\.html$/.test(entry.name))) {
  const file = join(site, 'pages', page.name);
  const before = await readFile(file, 'utf8');
  let after = before;
  for (const [name, content] of shared) {
    part(before, name);
    after = after.replace(markers(name), () => content);
  }
  if (after !== before) await writeFile(file, after);
  console.log('Общая шапка и подвал: ' + page.name);
}
