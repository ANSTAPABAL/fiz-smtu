(() => {
  const keyFor = category => {
    const value = String(category || '').toLowerCase();
    if (value.includes('гто')) return 'gto';
    if (value.includes('разряд') || value.includes('звание')) return 'rank';
    if (value.includes('сборная') || value.includes('секция')) return 'team';
    if (value.includes('мероприят')) return 'event';
    return 'other';
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-achievement-filter]');
    if (!button) return;
    const filter = button.dataset.achievementFilter;
    document.querySelectorAll('[data-achievement-filter]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelectorAll('#achievementBody tr').forEach(row => {
      const category = row.children[1]?.textContent || '';
      row.hidden = filter !== 'all' && keyFor(category) !== filter;
    });
  });
})();
