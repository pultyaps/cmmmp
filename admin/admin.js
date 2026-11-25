'use strict';

const section = document.getElementById('section');
const editor = document.getElementById('editor');
const status = document.getElementById('status');
const saveButton = document.getElementById('save');
const publishButton = document.getElementById('publish');
const presets = {
  news: { category:'Семинары', day:'', month:'', year:'', title:'', speaker:'', timePlace:'', excerpt:'', fullText:'' },
  documents: { title:'', meta:'', summary:'', highlights:[], url:'' },
  faq: { q:'', a:'' },
  faculty: { initials:'', name:'', title:'', tags:[], accent:'from-navy-900 to-navy-700' },
  leaders: { initials:'', name:'', role:'', title:'', description:'' },
  courses: { title:'', lecturer:'', semester:'', format:'', categories:['mandatory'], credits:'', syllabus:[] }
};
const labels = {
  category:'Категория', day:'День', month:'Месяц', year:'Год', title:'Заголовок', speaker:'Докладчик или организатор',
  timePlace:'Время и место', excerpt:'Анонс', fullText:'Полный текст', meta:'Тип и краткие сведения',
  summary:'Описание', highlights:'Пункты описания (по одному на строку)', url:'Ссылка на PDF',
  name:'ФИО', initials:'Инициалы', role:'Роль', description:'Описание', tags:'Направления (по одному на строку)',
  lecturer:'Преподаватель', semester:'Семестр', format:'Формат', credits:'Аттестация',
  categories:'Вкладки учебного плана', syllabus:'Темы курса (по одной на строку)',
  q:'Вопрос', a:'Ответ', intro:'Вводный текст', address:'Адрес', weekday:'График в будни',
  weekend:'График в выходные', email:'Электронная почта', phone:'Телефон', extension:'Добавочный номер и примечание'
};
let canPublish = false;
let content;
let revision;
let dirty = false;
let busy = false;

function element(tag, text) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function button(label, action) {
  const control = element('button', label);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

function dirtyState() {
  dirty = true;
  status.textContent = 'Есть несохранённые изменения.';
}

function fields(record, updateTitle) {
  const panel = element('div');
  panel.className = 'stack';
  for (const [key, current] of Object.entries(record)) {
    if (['id','accent'].includes(key)) continue;
    if (key === 'categories') {
      const box = element('fieldset');
      box.append(element('legend', labels[key]));
      for (const [value, caption] of Object.entries({
        mandatory:'Обязательные', special:'Спецкурсы', seminars:'Семинары', year12:'1–2 курс', year34:'3–4 курс'
      })) {
        const label = element('label');
        label.className = 'choice';
        const checkbox = element('input');
        checkbox.type = 'checkbox';
        checkbox.value = value;
        checkbox.checked = current.includes(value);
        label.append(checkbox, document.createTextNode(caption));
        box.append(label);
      }
      box.addEventListener('change', () => {
        record.categories = Array.from(box.querySelectorAll(':checked'), (node) => node.value);
        dirtyState();
      });
      panel.append(box);
      continue;
    }
    const requiredKey = Object.hasOwn(record, 'name') ? 'name' : Object.hasOwn(record, 'q') ? 'q' : 'title';
    const required = Boolean(updateTitle) && key === requiredKey;
    const caption = key === 'title' && requiredKey === 'name' ? 'Должность или степень' : labels[key];
    const wrap = element('label', caption + (required ? ' (обязательно)' : ''));
    const multiline = Array.isArray(current) || ['excerpt','fullText','summary','a','intro'].includes(key);
    const input = element(key === 'category' ? 'select' : multiline ? 'textarea' : 'input');
    if (key === 'category') {
      for (const name of ['Семинары','Объявления','События']) input.add(new Option(name,name));
    }
    if (key === 'email') input.type = 'email';
    input.value = Array.isArray(current) ? current.join('\n') : current;
    input.addEventListener('input', () => {
      record[key] = Array.isArray(current) ? input.value.split('\n').map((line) => line.trim()).filter(Boolean) : input.value;
      updateTitle?.();
      dirtyState();
    });
    wrap.append(input);
    panel.append(wrap);
  }
  return panel;
}

function render(openIndex = -1) {
  editor.replaceChildren();
  const key = section.value;
  if (key === 'contacts') {
    const panel = fields(content.contacts);
    panel.classList.add('panel');
    editor.append(panel);
    return;
  }
  const list = content[key];
  const put = (entry) => {
    if (list.length >= 200) {
      status.textContent = 'Достигнут предел в 200 записей.';
      return;
    }
    if (['news','documents','courses'].includes(key)) entry.id = crypto.randomUUID();
    list.push(entry);
    dirtyState();
    render(list.length - 1);
  };
  const add = button('Добавить запись', () => put(structuredClone(presets[key])));
  const actions = element('div');
  actions.append(add);
  editor.append(actions);
  if (key === 'documents') editor.append(element('p', 'Укажите HTTPS-ссылку на PDF или путь от корня сайта, например /files/booklet.pdf.'));
  list.forEach((record,index) => {
    const details = element('details');
    const summary = element('summary');
    const updateTitle = () => { summary.textContent = record.name || record.title || record.q || 'Новая запись'; };
    updateTitle();
    details.open = index === openIndex;
    const panel = fields(record, updateTitle);
    const row = element('div');
    row.className = 'row';
    const move = (offset) => {
      const target = index + offset;
      [list[index], list[target]] = [list[target], list[index]];
      dirtyState();
      render(target);
    };
    const up = button('Выше', () => move(-1));
    const down = button('Ниже', () => move(1));
    up.disabled = index === 0;
    down.disabled = index === list.length - 1;
    const remove = button('Удалить', () => {
      if (!confirm('Удалить запись из черновика?')) return;
      list.splice(index,1);
      dirtyState();
      render();
    });
    remove.className = 'danger';
    row.append(up, down, button('Дублировать', () => put(structuredClone(record))), remove);
    panel.append(row);
    details.append(summary,panel);
    editor.append(details);
    if (details.open) details.scrollIntoView({block:'nearest'});
  });
}

async function request(options) {
  const response = await fetch('/admin/content', options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

async function save(publish) {
  if (!content || busy || (publish && !confirm('Опубликовать текущие правки для всех посетителей?'))) return;
  busy = true;
  editor.inert = true;
  saveButton.disabled = publishButton.disabled = true;
  status.textContent = publish ? 'Публикация…' : 'Сохранение…';
  try {
    const result = await request({
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ revision, content, publish })
    });
    revision = result.revision;
    dirty = false;
    status.textContent = publish ? 'Правки опубликованы.' : 'Черновик сохранён. Его можно открыть в предпросмотре.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    busy = false;
    editor.inert = false;
    saveButton.disabled = false;
    publishButton.disabled = !canPublish;
  }
}

saveButton.addEventListener('click', () => save(false));
publishButton.addEventListener('click', () => save(true));
section.addEventListener('change', () => { if (content) render(); });
window.addEventListener('beforeunload', (event) => {
  if (dirty) {
    event.preventDefault();
    event.returnValue = true;
  }
});

request().then((result) => {
  ({revision, content, canPublish} = result);
  document.getElementById('account').textContent = result.username;
  publishButton.hidden = !canPublish;
  render();
  saveButton.disabled = false;
    publishButton.disabled = !canPublish;
  status.textContent = 'Черновик загружен.';
}).catch((error) => { status.textContent = error.message; });
