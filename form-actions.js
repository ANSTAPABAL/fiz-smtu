// Lock before file reading or network work so a second click cannot submit again.
async function runFormAction(button, action) {
  if (button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = button.form?.id === 'login-form' ? 'Входим…' : 'Сохраняем…';
  button.setAttribute('aria-busy', 'true');
  try { return await action(); }
  finally { button.textContent = label; button.disabled = false; button.removeAttribute('aria-busy'); }
}

const originalAchievementOptions = new WeakMap();
function filterAchievementChoices(key, distinction, status) {
  if (!originalAchievementOptions.has(distinction)) {
    originalAchievementOptions.set(distinction, [...distinction.options].map(option => option.cloneNode(true)));
  }
  const previous = distinction.value;
  const options = originalAchievementOptions.get(distinction).filter(option => !option.value ||
    (key === 'gto' ? /знак/i.test(option.textContent) : key === 'rank' && !/знак/i.test(option.textContent)));
  distinction.replaceChildren(...options.map(option => option.cloneNode(true)));
  distinction.value = options.some(option => option.value === previous) ? previous : '';
  if (status) {
    const previousStatus = status.value;
    const values = key === 'team' || key === 'section' ? ['Включен', 'Исключен', 'На проверке'] :
      key === 'event' ? ['Подтверждено', 'На проверке'] : ['Действующий', 'Подтверждено', 'На проверке', 'Не действует'];
    status.replaceChildren(...values.map(value => new Option(value, value)));
    status.value = values.includes(previousStatus) ? previousStatus : values[0];
  }
}
