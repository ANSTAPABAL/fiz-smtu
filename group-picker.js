const groups=['12509-05','12509-01','12509-02','12509-03','12509-04','12510-01','12510-02','12511-01','12609-01'];
const pick=s=>document.querySelector(s);
function drawGroups(query=''){
  const q=query.toLowerCase();
  pick('#groupOptions').innerHTML=groups.filter(g=>g.toLowerCase().includes(q)).map(g=>`<button class="group-option ${g===activeGroup?'selected':''}" data-group="${g}"><span><b>${g}</b><small> · тестовый контур</small></span></button>`).join('')||'<p>Группа не найдена</p>';
}
function openGroups(){drawGroups();pick('#groupMenu').hidden=false;pick('#groupPickerButton').setAttribute('aria-expanded','true');pick('#groupSearch').focus()}
function closeGroups(){pick('#groupMenu').hidden=true;pick('#groupPickerButton').setAttribute('aria-expanded','false')}
function placeGroupPicker(){const target=document.querySelector('.active-view .heading-actions');if(target)target.prepend(pick('#groupPicker'))}
window.placeGroupPicker=placeGroupPicker;
pick('#groupPickerButton').onclick=()=>pick('#groupMenu').hidden?openGroups():closeGroups();
pick('#groupSearch').oninput=e=>drawGroups(e.target.value);
document.addEventListener('click',e=>{
  const choice=e.target.closest('[data-group]');
  if(choice){window.setActiveGroup(choice.dataset.group);closeGroups();window.toast?.(`Выбрана группа ${choice.dataset.group}. Данные обновлены.`)}
  else if(!e.target.closest('.group-picker'))closeGroups();
});
placeGroupPicker();
