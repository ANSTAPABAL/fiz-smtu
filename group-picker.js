const picker = selector => document.querySelector(selector);
let availableGroups = [];
let selectedFaculty = '';
let selectedDirection = '';
let selectedCourse = '';
const safeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const groupName = group => group.display_code || group.group_code;
window.groupDisplayName = code => groupName(availableGroups.find(group => group.group_code === code) || {group_code:code});
const uniqueBy = (items, key) => [...new Map(items.map(item => [item[key], item])).values()];
const countGroups = items => `${items.length} ${items.length === 1 ? 'группа' : items.length < 5 ? 'группы' : 'групп'}`;
function button(label, count, active, attribute, value, className='') {
  return `<button class="group-option ${className} ${active?'selected':''}" ${attribute}="${safeText(value)}" aria-pressed="${active}"><span>${safeText(label)}</span><small>${count}</small></button>`;
}
function drawGroups(query = '') {
  const needle = query.trim().toLocaleLowerCase('ru');
  const searching = Boolean(needle);
  const globalMatches = availableGroups.filter(group => [groupName(group),group.group_code,group.faculty,group.direction,`${group.course} курс`].join(' ').toLocaleLowerCase('ru').includes(needle));
  const faculties = uniqueBy(searching ? globalMatches : availableGroups, 'faculty').filter(group=>group.faculty);
  picker('#facultyOptions').innerHTML = faculties.map(item=>{
    const bucket=(searching?globalMatches:availableGroups).filter(group=>group.faculty===item.faculty);
    return button(item.faculty,countGroups(bucket),searching?item.faculty===globalMatches[0]?.faculty:item.faculty===selectedFaculty,'data-faculty',item.faculty);
  }).join('') || '<p class="empty-state">Факультеты не найдены</p>';

  const inFaculty=searching?globalMatches:availableGroups.filter(group=>!selectedFaculty||group.faculty===selectedFaculty);
  const directions=uniqueBy(inFaculty,'direction').filter(group=>group.direction);
  picker('#directionOptions').innerHTML=directions.map(item=>{
    const bucket=inFaculty.filter(group=>group.direction===item.direction);
    return button(item.direction,countGroups(bucket),searching?item.direction===globalMatches[0]?.direction:item.direction===selectedDirection,'data-direction',item.direction);
  }).join('') || '<p class="empty-state">Выберите факультет</p>';

  const inDirection=searching?globalMatches:inFaculty.filter(group=>!selectedDirection||group.direction===selectedDirection);
  const courses=[...new Set(inDirection.map(group=>group.course).filter(Boolean))].sort((a,b)=>a-b);
  picker('#courseOptions').innerHTML=courses.map(course=>{
    const bucket=inDirection.filter(group=>Number(group.course)===Number(course));
    return button(`${course} курс`,countGroups(bucket),searching?Number(course)===Number(globalMatches[0]?.course):Number(course)===Number(selectedCourse),'data-course',course);
  }).join('') || '<p class="empty-state">Выберите направление</p>';

  let matches=searching?globalMatches:availableGroups.filter(group=>
    (!selectedFaculty||group.faculty===selectedFaculty)&&
    (!selectedDirection||group.direction===selectedDirection)&&
    (!selectedCourse||Number(group.course)===Number(selectedCourse)));
  picker('#groupOptions').innerHTML=matches.map(group=>button(groupName(group),`${group.students} студ.`,group.group_code===activeGroup,'data-group',group.group_code,'group-choice')).join('') || '<p class="empty-state">Группы не найдены</p>';
}
function openGroups() {
  const current=availableGroups.find(group=>group.group_code===activeGroup);
  if(current){selectedFaculty=current.faculty||'';selectedDirection=current.direction||'';selectedCourse=current.course||'';}
  picker('#groupSearch').value='';
  drawGroups();
  picker('#groupMenu').hidden=false;
  picker('#groupPickerButton').setAttribute('aria-expanded','true');
  picker('#groupSearch').focus();
}
function closeGroups() {
  picker('#groupMenu').hidden=true;
  picker('#groupPickerButton').setAttribute('aria-expanded','false');
}
function placeGroupPicker() {
  const actions=document.querySelector('.active-view .heading-actions');
  const groupPicker=picker('#groupPicker');
  if(actions && groupPicker.parentElement!==actions) actions.prepend(groupPicker);
}
window.placeGroupPicker=placeGroupPicker;
picker('#groupPickerButton').onclick=()=>picker('#groupMenu').hidden?openGroups():closeGroups();
picker('#groupSearch').oninput=event=>drawGroups(event.target.value);
document.addEventListener('click',event=>{
  const faculty=event.target.closest('[data-faculty]');
  const direction=event.target.closest('[data-direction]');
  const course=event.target.closest('[data-course]');
  const choice=event.target.closest('[data-group]');
  if(faculty){selectedFaculty=faculty.dataset.faculty;selectedDirection='';selectedCourse='';picker('#groupSearch').value='';drawGroups();}
  else if(direction){selectedDirection=direction.dataset.direction;selectedCourse='';picker('#groupSearch').value='';drawGroups();}
  else if(course){selectedCourse=course.dataset.course;picker('#groupSearch').value='';drawGroups();}
  else if(choice){window.setActiveGroup(choice.dataset.group);closeGroups();}
  else if(!event.target.closest('.group-picker'))closeGroups();
});
placeGroupPicker();
fetch('/api/groups').then(response=>response.json()).then(data=>{
  availableGroups=data.groups||[];
  if(!availableGroups.some(group=>group.group_code===activeGroup) && availableGroups.length){
    activeGroup=availableGroups.find(group=>group.display_code==='12509-05')?.group_code||availableGroups[0].group_code;
    localStorage.setItem('fkis-active-group',activeGroup);
    window.setActiveGroup(activeGroup);
  }
  window.updateGroupLabels?.();
  drawGroups();
}).catch(()=>{picker('#groupOptions').innerHTML='<p class="empty-state">Не удалось загрузить список групп</p>';});
