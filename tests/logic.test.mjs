// Tests for the pure logic in logic.js. Run: node tests/logic.test.mjs
import { createRequire } from 'node:module';
import assert from 'node:assert';

const require = createRequire(import.meta.url);
const L = require('../logic.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log('ok -', name);
}

check('sanitizeSecret keeps letters only, uppercase, max 16', () => {
  assert.equal(L.sanitizeSecret('hello world!'), 'HELLOWORLD');
  assert.equal(L.sanitizeSecret('a'.repeat(30)).length, 16);
  assert.equal(L.sanitizeSecret(''), '');
});

check('acrosticOf and verifyAcrostic', () => {
  assert.equal(L.acrosticOf(['house', 'elephant', 'lion', 'lamp', 'owl']), 'HELLO');
  assert.equal(L.verifyAcrostic(['house', 'owl'], 'HO'), true);
  assert.equal(L.verifyAcrostic(['house', 'owl'], 'HA'), false);
});

check('buildHideMessages carries the secret and per-letter ideas', () => {
  const msgs = L.buildHideMessages('HI', 'meadow');
  assert.equal(msgs.length, 2);
  assert.match(msgs[1].content, /secret word: HI/);
  assert.match(msgs[1].content, /letter H: pick one of house/);
  assert.match(msgs[1].content, /data-name/);
});

check('extractJson handles plain, fenced and prose-wrapped JSON', () => {
  assert.deepEqual(L.extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(L.extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(L.extractJson('sure, here: {"a":3} done'), { a: 3 });
  assert.equal(L.extractJson('no json at all'), null);
});

check('parseHideResponse reads JSON, fenced JSON and bare SVG', () => {
  const good = JSON.stringify({ title: 'T', objects: ['house', 'owl'], svg: '<svg><g data-name="house"></g></svg>' });
  const p1 = L.parseHideResponse(good);
  assert.equal(p1.title, 'T');
  assert.deepEqual(p1.objects, ['house', 'owl']);
  const p2 = L.parseHideResponse('look: <svg><g data-name="cat"></g></svg>');
  assert.deepEqual(p2.objects, ['cat']);
  assert.equal(L.parseHideResponse('nothing useful'), null);
});

check('parseRevealResponse normalizes fields', () => {
  const r = L.parseRevealResponse('{"found":true,"message":"HELLO","objects":["house"],"confidence":"high"}');
  assert.equal(r.found, true);
  assert.equal(r.message, 'HELLO');
  assert.equal(L.parseRevealResponse('junk'), null);
});

check('sanitizeSvg strips scripts, handlers and javascript URLs', () => {
  const dirty = '<svg onload="a()"><script>alert(1)</' + 'script><a href="javascript:x()"><rect onclick="b()"/></a></svg>';
  const clean = L.sanitizeSvg(dirty);
  assert.ok(!/script/i.test(clean));
  assert.ok(!/onload|onclick/i.test(clean));
  assert.ok(!/javascript:/i.test(clean));
});

check('mockHide builds a picture whose objects spell the secret', () => {
  const h = L.mockHide('CODE', 'night');
  assert.equal(L.verifyAcrostic(h.objects, 'CODE'), true);
  assert.ok(h.svg.startsWith('<svg'));
  assert.deepEqual(L.objectsFromSvg(h.svg), h.objects);
});

check('mockReveal reads the acrostic back', () => {
  const h = L.mockHide('HI', 'coast');
  const r = L.mockReveal(h.svg);
  assert.equal(r.found, true);
  assert.equal(r.message, 'HI');
  assert.equal(L.mockReveal('<svg></svg>').found, false);
});

check('gallery example hides HELLO', () => {
  const gEx = L.galleryExample();
  assert.equal(L.acrosticOf(gEx.objects), 'HELLO');
  assert.equal(L.mockReveal(gEx.svg).message, 'HELLO');
});

check('every letter has a mock object and an icon', () => {
  for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const name = L.MOCK_OBJECT[letter];
    assert.ok(name, 'missing mock object for ' + letter);
    assert.equal(typeof L.ICONS[name], 'function', 'missing icon for ' + name);
  }
});

check('isBalanceNotice spots the gateway low-balance reply', () => {
  assert.equal(L.isBalanceNotice("The account behind this API key doesn't have enough credits. This model needs paid Pollen."), true);
  assert.equal(L.isBalanceNotice('{"title":"x"}'), false);
});

console.log('\n' + passed + ' tests passed');
