const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Option {
  constructor(text, value = text) { this.textContent = text; this.value = value; }
  cloneNode() { return new Option(this.textContent, this.value); }
}
const context = vm.createContext({ Option });
vm.runInContext(fs.readFileSync('form-actions.js', 'utf8'), context);
const { runFormAction, filterAchievementChoices } = context;
function select(values) {
  return { options: values.map(value => new Option(value || 'Выберите', value)), value: '',
    replaceChildren(...options) { this.options = options; } };
}

(async () => {
  const button = { disabled: false, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; } };
  let calls = 0, finish;
  const saving = runFormAction(button, () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  await runFormAction(button, () => { calls++; });
  assert.equal(calls, 1, 'double click must send one request');
  assert.equal(button.disabled, true);
  finish(); await saving;
  assert.equal(button.disabled, false);
  assert.equal(button.attributes['aria-busy'], undefined);
  await assert.rejects(runFormAction(button, () => { throw new Error('network'); }), /network/);
  assert.equal(button.disabled, false, 'failed requests allow another attempt');

  const choices = select(['', 'Мастер спорта', 'Первый разряд', 'Золотой знак', 'Серебряный знак', 'Бронзовый знак']);
  const status = select(['Действующий']); status.value = 'Действующий';
  choices.value = 'Первый разряд';
  filterAchievementChoices('gto', choices, status);
  assert.deepEqual(choices.options.map(option => option.value), ['', 'Золотой знак', 'Серебряный знак', 'Бронзовый знак']);
  assert.equal(choices.value, '', 'changing category clears an incompatible selection');
  choices.value = 'Золотой знак';
  filterAchievementChoices('gto', choices, status);
  assert.equal(choices.value, 'Золотой знак', 'editing keeps a compatible value');
  filterAchievementChoices('rank', choices, status);
  assert.deepEqual(choices.options.map(option => option.value), ['', 'Мастер спорта', 'Первый разряд']);
  filterAchievementChoices('team', choices, status);
  assert.deepEqual(status.options.map(option => option.value), ['Включен', 'Исключен', 'На проверке']);
  filterAchievementChoices('event', choices, status);
  assert.deepEqual(status.options.map(option => option.value), ['Подтверждено', 'На проверке']);
  const login = fs.readFileSync('login.html', 'utf8');
  new vm.Script(login.match(/<script>([\s\S]*?)<\/script>/)[1]);
  console.log('Form actions: double click, retry, category switching and login syntax passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
