const filterRules={all:()=>true,gto:category=>category.includes('ГТО'),rank:category=>category.includes('разряд'),event:category=>category.includes('Мероприятие')};
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-achievement-filter]');
  if(!button)return;
  const filter=button.dataset.achievementFilter;
  document.querySelectorAll('[data-achievement-filter]').forEach(item=>item.classList.toggle('active',item===button));
  document.querySelectorAll('#achievementBody tr').forEach(row=>{
    const category=row.cells[1]?.textContent.trim()||'';
    row.hidden=!filterRules[filter](category);
  });
});
