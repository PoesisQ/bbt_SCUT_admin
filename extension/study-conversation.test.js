const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(setImmediate); };
let harnessId = 0;

function harness({storage, home: initialHome = {}, onChat, course = 'OS'} = {}) {
  const nodes = new Map(), requests = [], updates = [], timers = [], events = {};
  const instance = ++harnessId; let sequence = 0;
  const saved = storage || new Map([
    ['study-draft-text', 'My unsent question'],
    ['study-draft-files', JSON.stringify([{id: 'draft-file', name: 'slides.pdf', image: false}])],
  ]);
  let home = {turns: [], reviews: [], paused_reviews: [], due: [], operations: [], task_count: 0, ...initialHome};
  function element(tag = '') {
    return {tag, value: '', textContent: '', children: [], options: [], dataset: {}, style: {}, listeners: {}, scrollHeight: 40,
      classList: {add() {}, remove() {}, toggle() {}},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      setAttribute() {}, scrollIntoView() {}, focus() {}, close() { this.open = false; }, showModal() { this.open = true; }, contains() { return false; },
      async emit(type, event = {}) { for (const fn of this.listeners[type] || []) await fn(event); await settle(); },
    };
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  node('course').value = course; node('course').options = [{value: ''}, {value: 'OS'}];
  const budgets = ['15', '30', '60', 'custom'].map(value => ({value, checked: value === '30'}));
  const context = {
    URLSearchParams, setInterval(fn) { timers.push(fn); }, matchMedia: () => ({matches: true}),
    crypto: {randomUUID: () => `request-${instance}-${++sequence}`},
    sessionStorage: {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key)},
    document: {getElementById: node, createElement: element,
      querySelector: selector => selector === 'dialog[open]' ? null : selector === 'input[name="today-budget"]:checked' ? budgets.find(radio => radio.checked) : node(selector),
      querySelectorAll: selector => selector === 'input[name="today-budget"]' ? budgets : [],
      addEventListener(type, fn) { (events[type] ||= []).push(fn); }, body: {scrollHeight: 1000}},
    window: {innerHeight: 500, scrollY: 0},
    AssistantClient: {async api(route, options) {
      if (route.startsWith('/api/study/home?')) return home;
      if (route === '/api/study/chat') {
        const payload = JSON.parse(JSON.stringify(options.body)); requests.push(payload);
        return onChat ? onChat(payload, requests.length, value => { home = {...home, ...value}; }) : {};
      }
      if (route.startsWith('/api/study/reviews/')) {
        updates.push({route, ...options.body});
        const review = home.paused_reviews[0]; home = {...home, paused_reviews: [], reviews: [{...review, status: 'active', minutes: 5}]};
        return {...review, status: 'active'};
      }
      throw new Error('Unexpected route ' + route);
    }},
    StudyTools: {async load() {}}, StudyActions: {updateJobs() {}},
    StudySpecialized: {renderDaily() {}, renderMentions() {}},
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'study-conversation.js'), 'utf8'), context);
  function all(root) { return [root, ...root.children.flatMap(all)]; }
  return {node, requests, updates, saved, ready: settle,
    async chooseMinutes(value) {
      const preset = ['15', '30', '60'].includes(String(value)) ? String(value) : 'custom';
      for (const radio of budgets) radio.checked = radio.value === preset;
      node('today-minutes').value = String(value);
      await node('today-form').emit('change');
    },
    async confirmToday() { await node('today-form').emit('submit', {preventDefault() {}}); },
    button(root, label) { const button = all(node(root)).find(n => n.tag === 'button' && n.textContent === label); assert.ok(button, label); return button; },
    async submit() { await node('ask-form').emit('submit', {preventDefault() {}}); },
    async type(text) { node('question').value = text; await node('question').emit('input'); },
    async tick() { for (const fn of timers) fn(); await settle(); },
  };
}

test('Today uses its own inputs and preserves unrelated draft text, attachments and course', async () => {
  const h = harness(); await h.ready();
  await h.node('open-today').emit('click');
  assert.equal(h.requests.length, 0);
  await h.chooseMinutes(60); await h.confirmToday();
  assert.equal(h.requests[0].purpose, 'today'); assert.deepEqual(h.requests[0].attachments, []);
  assert.match(h.requests[0].question, /60 分钟/);
  assert.equal(h.requests[0].course, '');
  assert.equal(h.node('question').value, 'My unsent question');
  assert.equal(h.node('course').value, 'OS');
  assert.equal(JSON.parse(h.saved.get('study-draft-files'))[0].id, 'draft-file');
  assert.equal(h.saved.get('study-draft-text'), 'My unsent question');
});

test('opening or dismissing Today makes no request and keeps the draft intact', async () => {
  const h = harness(); await h.ready();
  await h.node('open-today').emit('click');
  assert.equal(h.node('today-dialog').open, true);
  await h.node('close-today').emit('click');
  assert.equal(h.node('today-dialog').open, false);
  assert.equal(h.requests.length, 0);
  assert.equal(h.node('question').value, 'My unsent question');
  assert.equal(h.saved.has('study-today-minutes'), false);
});

test('custom Today duration is validated and restored after reload', async () => {
  const h = harness(); await h.ready(); await h.node('open-today').emit('click');
  for (const invalid of ['', '0', '241', '12.5', 'invalid']) {
    await h.chooseMinutes(invalid); await h.confirmToday();
    assert.equal(h.requests.length, 0);
    assert.equal(h.node('today-error').hidden, false);
    assert.equal(h.node('today-dialog').open, true);
  }
  await h.chooseMinutes(45); await h.confirmToday();
  assert.match(h.requests[0].question, /45 分钟/);
  const next = harness({storage: h.saved}); await next.ready(); await next.node('open-today').emit('click');
  assert.equal(next.node('today-minutes').value, '45');
  assert.equal(next.node('custom-minutes-field').hidden, false);
  assert.equal(next.requests.length, 0);
});

test('Today stays open with feedback when another request is running', async () => {
  let finish;
  const h = harness({onChat: () => new Promise(resolve => { finish = resolve; })});
  await h.ready(); await h.submit(); await h.node('open-today').emit('click'); await h.confirmToday();
  assert.equal(h.requests.length, 1);
  assert.equal(h.node('today-dialog').open, true);
  assert.match(h.node('today-error').textContent, /上一条消息正在处理/);
  finish({}); await settle();
});

test('retrying a failed turn keeps its original request and review ID, leaving the new draft alone', async () => {
  const request = {conversation: 'main', client_id: 'original-id', question: 'Old question', course: '', purpose: 'auto', attachments: ['old-file'], review_id: 'review-1'};
  const h = harness({home: {turns: [{id: 'turn-1', status: 'failed', question: request.question, course: 'OS', purpose: 'ask', attachments: [], request_input: request}]}});
  await h.ready(); await h.button('conversation', '接着试一次').emit('click');
  assert.deepEqual(h.requests[0], request);
  assert.equal(h.node('question').value, 'My unsent question');
  assert.equal(JSON.parse(h.saved.get('study-draft-files'))[0].id, 'draft-file');
});

test('successful draft submission consumes only the submitted snapshot', async () => {
  const h = harness(); await h.ready(); await h.submit();
  assert.deepEqual(h.requests[0].attachments, ['draft-file']);
  assert.equal(h.node('question').value, ''); assert.deepEqual(JSON.parse(h.saved.get('study-draft-files')), []);
  await h.type('My unsent question'); await h.submit();
  assert.notEqual(h.requests[0].client_id, h.requests[1].client_id);
});

test('editing while a request is running preserves the new draft and its cached text', async () => {
  let finish;
  const h = harness({onChat: () => new Promise(resolve => { finish = resolve; })}); await h.ready();
  await h.submit(); await h.type('A newer question'); finish({}); await settle();
  assert.equal(h.node('question').value, 'A newer question');
  assert.equal(h.saved.get('study-draft-text'), 'A newer question');
  assert.equal(JSON.parse(h.saved.get('study-draft-files'))[0].id, 'draft-file');
});

test('transport retry reuses the full request after reload even before course options finish loading', async () => {
  const first = harness({onChat: () => { throw new Error('lost response'); }}); await first.ready(); await first.submit();
  const next = harness({storage: first.saved, course: ''}); await next.ready(); await next.submit();
  assert.deepEqual(next.requests[0], first.requests[0]);
  assert.equal(next.node('question').value, '');
  assert.deepEqual(JSON.parse(next.saved.get('study-pending-requests')), []);
});

test('changing the question after a transport failure starts a separate request', async () => {
  const h = harness({onChat: (_body, count) => { if (count === 1) throw new Error('lost response'); return {}; }});
  await h.ready(); await h.submit(); await h.type('A different question'); await h.submit();
  assert.notEqual(h.requests[0].client_id, h.requests[1].client_id);
});

test('a saved successful turn reconciles a lost response without resubmitting the draft', async () => {
  const h = harness({onChat: (body, _count, update) => {
    update({turns: [{id: 'done', status: 'ready', question: body.question, course: 'OS', attachments: [], request_input: body, result: {}}]});
    throw new Error('lost response');
  }});
  await h.ready(); await h.submit();
  assert.equal(h.requests.length, 1); assert.equal(h.node('question').value, '');
  assert.deepEqual(JSON.parse(h.saved.get('study-pending-requests')), []);
});

test('paused reviews remain discoverable and can be resumed from the review dialog', async () => {
  const review = {id: 'r1', course: 'OS', topic: 'Processes', due_at: 1800000000, attempts: [{rating: 3}], status: 'paused'};
  const h = harness({home: {paused_reviews: [review]}}); await h.ready();
  await h.node('manage-reviews').emit('click'); await h.button('review-list', '恢复复习').emit('click');
  assert.deepEqual(h.updates, [{route: '/api/study/reviews/r1', action: 'resume'}]);
  assert.match(h.node('notice').textContent, /已恢复复习/);
  assert.equal(h.node('question').value, 'My unsent question');
});
