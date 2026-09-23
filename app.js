let students = [];
let achievements = [];
let physicalTests = [];
let summary = {};
let activeGroup = localStorage.getItem('fkis-active-group') || '0905';
let selectedStudentId = null;
let selectedAchievementId = null;
let activeDiscipline = '';
let studentFilter = 'all';
let selectedRole = localStorage.getItem('fkis-role') || 'Преподаватель';
const $ = selector => document.querySelector(selector);
const initials = name => name.split(/\s+/).map(part => part[0]).join('').slice(0, 2);
const shortName = name => name.split(/\s+/).slice(0, 2).join(' ');
const todayLocal = () => { const now=new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`; };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const isoDate = value => {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = String(value).match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : '';
};
const displayDate = value => {
  const date = isoDate(value);
  return date ? date.split('-').reverse().join('.') : (value || '—');
};
async function api(url, method = 'GET', body) {
  const response = await fetch(url, {method, headers:{'Content-Type':'application/json'}, body:body && JSON.stringify(body)});
  if (response.status === 401 && !location.pathname.startsWith('/login')) { location.assign('/login'); throw new Error('Сессия завершена. Войдите снова.'); }
  if (!response.ok) {
    let message = 'Ошибка запроса';
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  return response.json();
}
api('/api/session').then(session => {
  const signOut = $('#signOut');
  if (session.auth_enabled && session.authenticated && signOut) {
    signOut.hidden = false;
    signOut.onclick = async () => { await fetch('/api/logout', {method:'POST'}); location.assign('/login'); };
  }
}).catch(() => {});
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  setTimeout(() => $('#toast').classList.remove('show'), 2800);
}
function statusClass(value) {
  const v = String(value || '').toLowerCase();
  if (['зачет', 'действующий', 'подтверждено', 'включен'].includes(v)) return 'good';
  if (['не зачет', 'не действует', 'исключен'].includes(v)) return 'bad';
  return 'warn';
}
function categoryKey(category) {
  const c = String(category || '').toLowerCase();
  if (c.includes('гто')) return 'gto';
  if (c.includes('разряд') || c.includes('звание')) return 'rank';
  if (c.includes('сборная') || c.includes('секция')) return 'team';
  if (c.includes('мероприят')) return 'event';
  return 'other';
}
function updateGroupLabels() {
  const label = window.groupDisplayName?.(activeGroup) || activeGroup;
  document.querySelectorAll('[data-group-label]').forEach(node => node.textContent = label);
  const groupName = $('#topGroupName');
  if (groupName) groupName.textContent = label;
}
window.updateGroupLabels = updateGroupLabels;
function showRole() {
  $('#roleButton').innerHTML = `${escapeHtml(selectedRole)} <span>⌄</span>`;
  $('#roleMenu').hidden = true;
  $('#roleButton').setAttribute('aria-expanded', 'false');
  localStorage.setItem('fkis-role', selectedRole);
}
function render() {
  const displayedGroup = window.groupDisplayName?.(activeGroup) || activeGroup;
  $('#studentsBody').innerHTML = students.map((student, index) => `<tr><td>${index + 1}</td><td><div class="student-cell"><span class="avatar">${escapeHtml(initials(student.name))}</span><div><b>${escapeHtml(student.name)}</b><small>${escapeHtml(displayedGroup)}${student.isu_id ? ` · ИСУ ${escapeHtml(student.isu_id)}` : ''}</small></div></div></td><td>${escapeHtml(student.health || 'не указана')}</td><td><span class="status ${Number(student.attendance) < 70 && Number(student.attendance) > 0 ? 'bad' : Number(student.attendance) >= 70 ? 'good' : 'warn'}">${Number(student.attendance) > 0 ? `${student.attendance}%` : 'нет данных'}</span></td><td><span class="status ${statusClass(student.theory)}">${escapeHtml(student.theory || 'не указано')}${student.theory_date ? `<small class="date-note">${displayDate(student.theory_date)}</small>` : ''}</span></td><td><span class="status ${statusClass(student.practice)}">${escapeHtml(student.practice || 'не указано')}</span></td><td><button class="detail-button" data-student="${student.id}">Карточка</button></td></tr>`).join('');
  $('#attendanceBody').innerHTML = students.map((student, index) => {
    return `<tr><td>${index + 1}</td><td><div class="student-cell"><span class="avatar">${escapeHtml(initials(student.name))}</span><b>${escapeHtml(student.name)}</b></div></td><td>${escapeHtml(student.health || 'не указана')}</td><td><div class="attendance-toggle" data-id="${student.id}"><button class="${student.present ? 'on' : ''}" data-set="true">Присутствовал</button><button class="${!student.present ? 'off' : ''}" data-set="false">Отсутствовал</button></div></td></tr>`;
  }).join('');
  $('#achievementBody').innerHTML = achievements.map(item => {
    const key = categoryKey(item.category);
    const sportOrEvent = key === 'rank' ? item.sport_type : key === 'team' ? `${item.team_name || ''}${item.sport_type ? ` · ${item.sport_type}` : ''}` : key === 'event' ? item.details : '';
    const distinction = key === 'gto' ? `${item.distinction || ''}${item.age_group ? ` · ${item.age_group}` : ''}` : key === 'rank' ? item.distinction : key === 'team' ? item.status : item.event_result || item.participant_role;
    return `<tr><td><b>${escapeHtml(item.name)}</b></td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(sportOrEvent || '—')}</td><td>${escapeHtml(distinction || item.details || '—')}</td><td>${escapeHtml(displayDate(item.record_date))}</td><td>${item.document_name ? `<a class="document-link" href="/api/achievement-document/${item.id}">${escapeHtml(item.document_name)}</a>` : '—'}</td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td><button class="detail-button" data-achievement="${item.id}">Изменить</button></td></tr>`;
  }).join('');
  $('#attentionList').innerHTML = students.filter(student => Number(student.attendance) > 0 && Number(student.attendance) < 70).map(student => `<div class="attention-row"><span class="avatar">${escapeHtml(initials(student.name))}</span><div><b>${escapeHtml(shortName(student.name))}</b><small>${escapeHtml(window.groupDisplayName?.(activeGroup) || activeGroup)}</small></div><span class="attendance-score">${student.attendance}%</span></div>`).join('') || '<p class="empty-state">Нет студентов с посещаемостью ниже 70%.</p>';
  const studentOptions = students.map(student => `<option value="${student.id}">${escapeHtml(student.name)}</option>`).join('');
  $('#achievementStudent').innerHTML = studentOptions;
  $('#physicalStudent').innerHTML = studentOptions;
  $('#attendanceStudentCount').textContent = students.length;
  $('#studentListSummary').textContent = `${students.length} студентов · список из ИСУ`;
  $('#filterAll').textContent = `Все · ${students.length}`;
  $('#filterCredit').textContent = `Зачет · ${students.filter(s => s.practice === 'зачет').length}`;
  $('#filterAttention').textContent = `Внимание · ${students.filter(s => Number(s.attendance) > 0 && Number(s.attendance) < 70).length}`;
  renderPhysical();
  renderStats();
  renderConsolidated();
  applyStudentFilter();
}
function renderPhysical() {
  const position = new Map(students.map((student, index) => [student.id, index + 1]));
  $('#physicalBody').innerHTML = physicalTests.map(item => `<tr><td>${position.get(item.student_id) || '—'}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.exercise)}</td><td>${escapeHtml(item.result)}</td><td>${escapeHtml(displayDate(item.record_date))}</td><td><button class="detail-button" data-physical="${item.id}">Изменить</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">Результаты испытаний пока не внесены.</td></tr>';
}
function countByLabel(items, label) {
  return Number((items || []).find(item => String(item.label).toLowerCase() === label)?.count || 0);
}
function renderStats() {
  const total = students.length;
  const avg = total ? Math.round(students.reduce((sum, student) => sum + Number(student.attendance || 0), 0) / total) : 0;
  const attendanceHasData = Number(summary.attendance?.lessons || 0) > 0;
  const practice = students.filter(student => student.practice === 'зачет').length;
  const unknownHealth = students.filter(student => !['основная','подготовительная','специальная'].includes(String(student.health).toLowerCase())).length;
  const healthCount = label => countByLabel(summary.health, label);
  const pct = value => total ? `${Math.round(value / total * 100)}%` : '—';
  $('#metricStudents').textContent = total;
  $('#metricAttendance').textContent = attendanceHasData ? `${avg}%` : '—';
  $('#metricCredit').textContent = students.some(student => student.practice !== 'не указано') ? `${practice} / ${total}` : '—';
  $('#metricCreditShare').textContent = students.some(student => student.practice !== 'не указано') ? `${pct(practice)} группы` : 'оценки еще не внесены';
  $('#metricAttention').textContent = students.filter(student => Number(student.attendance) > 0 && Number(student.attendance) < 70).length;
  $('#reportMain').textContent = healthCount('основная');
  $('#reportMainShare').textContent = `${pct(healthCount('основная'))} студентов`;
  $('#reportPrep').textContent = healthCount('подготовительная');
  $('#reportPrepShare').textContent = `${pct(healthCount('подготовительная'))} студентов`;
  $('#reportSpecial').textContent = healthCount('специальная');
  $('#reportSpecialShare').textContent = `${pct(healthCount('специальная'))} студентов`;
  $('#reportEvents').textContent = new Set(achievements.filter(item => categoryKey(item.category) === 'event').map(item => item.student_id)).size;
  $('#cardHealthMain').textContent = healthCount('основная');
  $('#cardHealthPrep').textContent = healthCount('подготовительная');
  $('#cardHealthSpecial').textContent = healthCount('специальная');
  $('#cardHealthUnknown').textContent = unknownHealth;
  const credited = students.filter(s => s.theory === 'зачет' && s.practice === 'зачет').length;
  const events = achievements.filter(a => categoryKey(a.category) === 'event');
  const gto = achievements.filter(a => categoryKey(a.category) === 'gto');
  const ranks = achievements.filter(a => categoryKey(a.category) === 'rank');
  const teams = achievements.filter(a => categoryKey(a.category) === 'team' && a.status !== 'Исключен');
  $('#groupCardBody').innerHTML = [
    ['Состав группы','Всего студентов',total],
    ['Здоровье','Не указана',unknownHealth],
    ['Посещаемость','Сохранено отметок',Number(summary.attendance?.lessons || 0)],
    ['Посещаемость','Общая доля присутствия',attendanceHasData ? `${Math.round(Number(summary.attendance.present || 0) / Number(summary.attendance.lessons) * 100)}%` : 'нет отметок'],
    ['ТиМ ФКиС','Зачет / не зачет / не указано',`${students.filter(s=>s.theory==='зачет').length} / ${students.filter(s=>s.theory==='не зачет').length} / ${students.filter(s=>!['зачет','не зачет'].includes(s.theory)).length}`],
    ['Практика ФКиС','Зачет / не зачет / не указано',`${students.filter(s=>s.practice==='зачет').length} / ${students.filter(s=>s.practice==='не зачет').length} / ${students.filter(s=>!['зачет','не зачет'].includes(s.practice)).length}`],
    ['Общая оценка','Зачет по обоим показателям',credited],
    ['Сборная команда / секция','Действующие записи',teams.length],
    ['ВФСК «ГТО»','Учтено достижений',gto.length],
    ['Спортивное звание / разряд','Учтено достижений',ranks.length],
    ['Спортивные мероприятия','Записей участника или волонтера',events.length]
  ].map(row=>`<tr><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[2])}</td></tr>`).join('');
  const bars = (window.attendanceTrend || []).slice(0, 7).reverse();
  $('#attendanceBars').innerHTML = bars.length ? bars.map(row => {
    const percent = row.total ? Math.round(row.present / row.total * 100) : 0;
    return `<div title="${escapeHtml(displayDate(row.lesson_date))}: ${percent}%"><i style="height:${Math.max(3,percent)}%"></i><span>${escapeHtml(displayDate(row.lesson_date).slice(0,5))}</span></div>`;
  }).join('') : '<p class="empty-state">График появится после сохранения отметок посещаемости.</p>';
}
function renderConsolidated() {
  $('#consolidatedBody').innerHTML = students.map((student, index) => {
    const records = achievements.filter(item => item.student_id === student.id);
    const team = records.find(item => categoryKey(item.category) === 'team' && item.status !== 'Исключен');
    const gto = records.find(item => categoryKey(item.category) === 'gto');
    const rank = records.find(item => categoryKey(item.category) === 'rank');
    const eventRecords = records.filter(item => categoryKey(item.category) === 'event');
    const initialsName = student.name.split(/\s+/).map((part,index) => index ? `${part[0]}.` : part).join(' ');
    const overall = student.theory === 'зачет' && student.practice === 'зачет' ? 'зачет' : student.theory === 'не зачет' || student.practice === 'не зачет' ? 'не зачет' : 'не указано';
    return `<tr><td>${index+1}</td><td>${escapeHtml(initialsName)}</td><td>${escapeHtml(student.health || 'не указана')}</td><td>${escapeHtml(student.theory || 'не указано')}</td><td>${escapeHtml(student.practice || 'не указано')}</td><td>${escapeHtml(overall)}</td><td>${escapeHtml(team ? `${team.team_name || ''} ${team.sport_type || ''}`.trim() : '—')}</td><td>${escapeHtml(gto ? `${gto.distinction || 'знак'}${gto.age_group ? ` · ${gto.age_group}` : ''}` : '—')}</td><td>${escapeHtml(rank ? `${rank.distinction || ''}${rank.sport_type ? ` · ${rank.sport_type}` : ''}` : '—')}</td><td>${escapeHtml(eventRecords.map(item=>item.details || item.event_result).filter(Boolean).join('; ') || '—')}</td><td>${eventRecords.filter(item=>item.participant_role==='Участник').length || '—'}</td><td>${eventRecords.filter(item=>item.participant_role==='Волонтер').length || '—'}</td></tr>`;
  }).join('');
}
function applyStudentFilter() {
  document.querySelectorAll('#studentsBody tr').forEach((row,index) => {
    const student = students[index];
    if (!student) return;
    row.hidden = studentFilter === 'credit' ? student.practice !== 'зачет' : studentFilter === 'attention' ? !(Number(student.attendance)>0 && Number(student.attendance)<70) : false;
  });
  const query = ($('#studentSearch')?.value || '').trim().toLowerCase();
  if (query) document.querySelectorAll('#studentsBody tr').forEach((row,index) => { if (!students[index]?.name.toLowerCase().includes(query)) row.hidden=true; });
}
async function load() {
  const dateValue = $('#lessonDate')?.value || todayLocal();
  const data = await api(`/api/bootstrap?group=${encodeURIComponent(activeGroup)}&date=${encodeURIComponent(dateValue)}`);
  activeGroup = data.group || activeGroup;
  const attendanceMap = new Map((data.attendance_records || []).map(row => [Number(row.student_id),row]));
  students = (data.students || []).map(student => ({...student,attendance:student.computed_attendance ?? student.attendance,present:Number(attendanceMap.get(Number(student.id))?.present || 0)===1}));
  const topicRecord=(data.attendance_records||[]).find(record=>record.topic)?.topic;
  if(topicRecord && activeDiscipline){const savedTheme=String(topicRecord).split(' · ').slice(1).join(' · ');if(savedTheme)$('#lessonTopic').value=savedTheme;}
  else if($('#attendanceJournal') && !$('#attendanceJournal').hidden)$('#lessonTopic').value='';
  achievements = data.achievements || [];
  physicalTests = data.physical_tests || [];
  summary = data.summary || {};
  window.attendanceTrend = data.attendance_trend || [];
  updateGroupLabels();
  render();
}
window.toast = toast;
window.setActiveGroup = group => {
  activeGroup = group;
  localStorage.setItem('fkis-active-group', group);
  updateGroupLabels();
  load().then(()=>toast(`Открыта группа ${window.groupDisplayName?.(group) || group}.`)).catch(()=>toast('Не удалось загрузить данные группы.'));
};
function resetAttendanceFlow() {
  activeDiscipline = '';
  $('#disciplineSelect').value = '';
  $('#confirmDiscipline').disabled = true;
  $('#lessonTopic').value = '';
  $('#attendanceSetup').hidden = false;
  $('#attendanceJournal').hidden = true;
  $('#saveAttendance').hidden = true;
  $('#attendanceSubtitle').innerHTML = `Группа <span data-group-label>${escapeHtml(window.groupDisplayName?.(activeGroup) || activeGroup)}</span> · выберите дисциплину`;
}
function go(view) {
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('active-view', section.id === view));
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  if (view === 'attendance') resetAttendanceFlow();
  window.placeGroupPicker?.();
  scrollTo({top:0,behavior:'smooth'});
}
function studentCard(id) {
  const student = students.find(item => item.id === Number(id));
  if (!student) return;
  selectedStudentId = student.id;
  const records = achievements.filter(item => item.student_id === student.id);
  const physical = physicalTests.filter(item => item.student_id === student.id);
  $('#modalStudentName').textContent = student.name;
  $('#studentDetails').innerHTML = `<div class="detail-grid">
    <div><span>Учебная группа (ИСУ)</span><b>${escapeHtml(window.groupDisplayName?.(activeGroup) || activeGroup)}</b></div>
    <div><span>ISU ID</span><b>${escapeHtml(student.isu_id || 'не получен')}</b></div>
    <div><span>Номер зачетной книжки</span><b>${escapeHtml(student.enrollment_number || 'не получен')}</b></div>
    <div><span>Дата рождения</span><b>${escapeHtml(displayDate(student.birth_date) === '—' ? '' : displayDate(student.birth_date)) || 'не получена из выгрузки'}</b></div>
    <div><span>Группа здоровья</span><b>${escapeHtml(student.health || 'не указана')}</b></div>
    <div><span>ТиМ ФКиС</span><b>${escapeHtml(student.theory || 'не указано')}${student.theory_date ? ` · ${escapeHtml(displayDate(student.theory_date))}` : ''}</b></div>
    <div><span>Посещаемость</span><b>${Number(student.attendance)>0 ? `${student.attendance}%` : 'пока нет отметок'}</b></div>
    <div><span>Практика ФКиС</span><b>${escapeHtml(student.practice || 'не указано')}</b></div>
    <div><span>Физическая подготовленность</span><b>${physical.length ? physical.map(item=>`${escapeHtml(item.exercise)}: ${escapeHtml(item.result)}`).join('<br>') : 'результатов пока нет'}</b></div>
    <div><span>Спортивные достижения</span><b>${records.length ? records.map(item=>escapeHtml(item.category)).join('<br>') : 'нет записей'}</b></div>
  </div>`;
  $('#studentModal').hidden = false;
}
function fillCategoryFields(prefix, category) {
  const key = categoryKey(category);
  document.querySelectorAll(prefix ? '.edit-achievement-field' : '.achievement-field').forEach(field => {
    field.hidden = !field.dataset.for.split(/\s+/).includes(key);
  });
}
function formValue(prefix, suffix) { return $(`#${prefix}${suffix}`).value.trim(); }
function achievementPayload(prefix) {
  const category = formValue(prefix, 'Category');
  const key = categoryKey(category);
  const studentId = Number(formValue(prefix, 'Student'));
  const sportType = formValue(prefix, 'Sport');
  const distinction = formValue(prefix, 'Distinction');
  const ageGroup = formValue(prefix, 'AgeGroup');
  const teamName = formValue(prefix, 'Team');
  const section = formValue(prefix, 'Section');
  const role = formValue(prefix, 'Role');
  const eventName = formValue(prefix, 'Event');
  const eventResult = formValue(prefix, 'Result');
  const dateValue = formValue(prefix, 'Date') || todayLocal();
  if (!studentId) throw new Error('Выберите студента из списка.');
  if (key === 'rank' && (!sportType || !distinction)) throw new Error('Укажите вид спорта и спортивное звание или разряд.');
  if (key === 'gto' && (!ageGroup || !distinction)) throw new Error('Укажите возрастную ступень и знак ГТО.');
  if (key === 'team' && (!teamName || !section)) throw new Error('Укажите сборную команду и спортивную секцию.');
  if (key === 'event' && !eventName) throw new Error('Укажите наименование спортивного мероприятия.');
  const file = $(`#${prefix}Document`).files[0];
  if (file && (file.type !== 'application/pdf' || file.size > 10*1024*1024)) throw new Error('Прикрепите PDF-файл размером до 10 МБ.');
  return (async () => {
    let documentBase64 = '';
    if (file) {
      const dataUrl = await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось прочитать PDF-файл.'));reader.readAsDataURL(file);});
      documentBase64 = String(dataUrl).split(',')[1] || '';
    }
    return {
      student_id:studentId, category, details:key==='event'?eventName:'', record_date:dateValue,
      status:formValue(prefix,'Status'), sport_type:key==='rank'?sportType:key==='team'?section:'', distinction:key==='rank'||key==='gto'?distinction:'', age_group:key==='gto'?ageGroup:'',
      order_basis:formValue(prefix,'Order'), participant_role:key==='event'?role:'',
      event_result:key==='event'?eventResult:'', note:key==='event'?formValue(prefix,'Note'):'', team_name:key==='team'?teamName:'',
      document_name:file?.name || '', document_base64:documentBase64,
      remove_document:prefix==='editAchievement' && $('#removeAchievementDocument').checked
    };
  })();
}
function editAchievement(id) {
  const item = achievements.find(record => record.id === Number(id));
  if (!item) return;
  selectedAchievementId = item.id;
  $('#editAchievementStudent').innerHTML = students.map(student => `<option value="${student.id}">${escapeHtml(student.name)}</option>`).join('');
  $('#editAchievementStudent').value = item.student_id;
  $('#editAchievementCategory').value = item.category;
  if (!$('#editAchievementCategory').value) {
    const option = new Option(item.category, item.category);
    $('#editAchievementCategory').add(option);
    $('#editAchievementCategory').value = item.category;
  }
  $('#editAchievementSport').value = item.sport_type || '';
  $('#editAchievementDistinction').value = item.distinction || '';
  $('#editAchievementAgeGroup').value = item.age_group || '';
  $('#editAchievementTeam').value = item.team_name || '';
  $('#editAchievementSection').value = item.sport_type || '';
  $('#editAchievementRole').value = item.participant_role || 'Участник';
  $('#editAchievementEvent').value = item.details || '';
  $('#editAchievementResult').value = item.event_result || '';
  $('#editAchievementDate').value = isoDate(item.record_date) || todayLocal();
  $('#editAchievementOrder').value = item.order_basis || '';
  $('#editAchievementStatus').value = item.status || 'Подтверждено';
  $('#editAchievementNote').value = item.note || '';
  $('#editAchievementDocument').value = '';
  $('#removeAchievementDocument').checked = false;
  $('#editExistingDocument').hidden = !item.document_name;
  $('#editExistingDocument').innerHTML = item.document_name ? `Сейчас прикреплен: <a href="/api/achievement-document/${item.id}">${escapeHtml(item.document_name)}</a>` : '';
  fillCategoryFields('edit', item.category);
  $('#achievementEditModal').hidden = false;
}
async function readAchievementForm(prefix) { return await achievementPayload(prefix); }
function applyStudentSearch() { applyStudentFilter(); }
function updateTour() {
  const item = tour[step];
  go(item.view);
  $('#tourTitle').textContent = item.title;
  $('#tourText').textContent = item.text;
  $('#tourCount').textContent = `${step+1} из ${tour.length}`;
  $('#tourNext').textContent = step === tour.length - 1 ? 'Готово' : 'Далее';
  $('#tourMask').hidden = false;
  requestAnimationFrame(()=>requestAnimationFrame(placeTourSpotlight));
}
function placeTourSpotlight() {
  const item = tour[step];
  const target = document.querySelector(`#${item.view} ${item.target}`);
  const spotlight = $('#tourSpotlight');
  if (!target || target.offsetParent === null) { spotlight.style.width='0'; spotlight.style.height='0'; return; }
  const rect = target.getBoundingClientRect(), pad=8;
  spotlight.style.left=`${Math.max(6,rect.left-pad)}px`;
  spotlight.style.top=`${Math.max(6,rect.top-pad)}px`;
  spotlight.style.width=`${Math.min(innerWidth-12,rect.width+pad*2)}px`;
  spotlight.style.height=`${Math.min(innerHeight-12,rect.height+pad*2)}px`;
}
function closeGuide() { $('#tourMask').hidden=true; $('#tourSpotlight').removeAttribute('style'); }
const tour = [
  {view:'dashboard',target:'.metric-grid',title:'Карточка группы',text:'Сводные показатели пересчитываются по выбранной группе и сохраненным данным.'},
  {view:'students',target:'#studentsBody',title:'Список студентов',text:'Состав загружен из списка ИСУ. Откройте карточку, чтобы просмотреть и изменить данные студента.'},
  {view:'attendance',target:'#attendanceSetup',title:'Посещаемость',text:'Сначала выберите дисциплину и подтвердите выбор. Затем установите дату, отметьте каждого студента и сохраните журнал.'},
  {view:'physical',target:'.physical-setup',title:'Физическая подготовленность',text:'Выберите студента, дату и испытание. Запишите результат. Повторная запись того же упражнения за эту дату обновится.'},
  {view:'achievements',target:'.achievement-tabs',title:'Спортивные достижения',text:'Ведите спортивные разряды, ГТО, членство в сборной или секции и участие в мероприятиях. К записи можно приложить подтверждающий PDF.'},
  {view:'groupCard',target:'#groupCardBody',title:'Карточка группы',text:'Здесь собраны состав, здоровье, учебные зачеты, посещаемость и количество спортивных записей.'},
  {view:'reports',target:'#consolidatedBody',title:'Сводные данные',text:'Сводная ведомость отражает каждого студента и его спортивные результаты. Ее можно скачать в Excel.'}
];
let step = 0;

document.addEventListener('click', async event => {
  const nav = event.target.closest('.nav-item');
  const goButton = event.target.closest('[data-go]');
  const studentButton = event.target.closest('[data-student]');
  const achievementButton = event.target.closest('[data-achievement]');
  const physicalButton = event.target.closest('[data-physical]');
  const filter = event.target.closest('[data-student-filter]');
  const closeButton = event.target.closest('[data-close]');
  const attendanceButton = event.target.closest('[data-set]');
  const roleChoice = event.target.closest('[data-role]');
  if (nav) go(nav.dataset.view);
  if (goButton) go(goButton.dataset.go);
  if (studentButton) studentCard(studentButton.dataset.student);
  if (achievementButton) editAchievement(achievementButton.dataset.achievement);
  if (physicalButton) {
    const item=physicalTests.find(record=>record.id===Number(physicalButton.dataset.physical));
    if(item){$('#physicalStudent').value=item.student_id;$('#physicalDate').value=isoDate(item.record_date)||item.record_date;$('#physicalExercise').value=item.exercise;$('#physicalResult').value=item.result;$('#physicalExercise').focus();scrollTo({top:0,behavior:'smooth'});}
  }
  if (filter) {
    studentFilter=filter.dataset.studentFilter;
    document.querySelectorAll('[data-student-filter]').forEach(button=>button.classList.toggle('active',button===filter));
    applyStudentFilter();
  }
  if (closeButton) $(`#${closeButton.dataset.close}`).hidden=true;
  if (attendanceButton) {
    const student=students.find(item=>item.id===Number(attendanceButton.parentElement.dataset.id));
    if (student) { student.present=attendanceButton.dataset.set==='true'; render(); }
  }
  if (roleChoice) { selectedRole=roleChoice.dataset.role; showRole(); toast(`Выбрана роль «${selectedRole}».`); }
  if (!event.target.closest('.role-picker') && $('#roleMenu')) { $('#roleMenu').hidden=true; $('#roleButton').setAttribute('aria-expanded','false'); }
});
$('#studentSearch').addEventListener('input',applyStudentSearch);
$('#roleButton').onclick=()=>{const menu=$('#roleMenu');menu.hidden=!menu.hidden;$('#roleButton').setAttribute('aria-expanded',String(!menu.hidden));};
showRole();
$('#disciplineSelect').addEventListener('change',()=>$('#confirmDiscipline').disabled=!$('#disciplineSelect').value);
$('#confirmDiscipline').onclick=async()=>{
  const discipline=$('#disciplineSelect').value;
  if(!discipline)return toast('Сначала выберите дисциплину.');
  activeDiscipline=discipline;
  $('#activeDisciplineLabel').textContent=discipline;
  $('#attendanceSubtitle').innerHTML=`Группа <span data-group-label>${escapeHtml(window.groupDisplayName?.(activeGroup) || activeGroup)}</span> · ${escapeHtml(discipline)}`;
  $('#attendanceSetup').hidden=true;
  $('#attendanceJournal').hidden=false;
  $('#saveAttendance').hidden=false;
  $('#lessonTopic').value='';
  $('#saveAttendance').disabled=true;
  await load().catch(()=>toast('Не удалось загрузить журнал за выбранную дату.'));
  toast('Журнал открыт для отметки посещаемости.');
};
$('#changeDiscipline').onclick=resetAttendanceFlow;
$('#lessonTopic').addEventListener('change',()=>$('#saveAttendance').disabled=!$('#lessonTopic').value);
$('#lessonDate').addEventListener('change',()=>load().catch(()=>toast('Не удалось загрузить журнал за выбранную дату.')));
$('#saveAttendance').onclick=async()=>{
  if(!activeDiscipline)return toast('Сначала выберите дисциплину.');
  if(!$('#lessonTopic').value)return toast('Выберите тему занятия перед сохранением.');
  try { await api('/api/attendance','POST',{lesson_date:$('#lessonDate').value,topic:`${activeDiscipline} · ${$('#lessonTopic').value}`,items:students.map(student=>({id:student.id,present:!!student.present}))}); await load(); toast('Отметки и тема занятия сохранены.'); }
  catch(error) { toast(error.message); }
};
$('#physicalDate').value=todayLocal();
$('#lessonDate').value=todayLocal();
$('#savePhysical').onclick=async()=>{
  const exercise=$('#physicalExercise').value.trim(),result=$('#physicalResult').value.trim(),studentId=Number($('#physicalStudent').value);
  if(!studentId||!exercise||!result)return toast('Выберите студента, упражнение и укажите результат.');
  try { await api('/api/physical-tests','POST',{student_id:studentId,record_date:$('#physicalDate').value,exercise,result}); $('#physicalExercise').value=''; $('#physicalResult').value=''; await load(); toast('Результат физической подготовленности сохранен.'); }
  catch(error) { toast(error.message); }
};
$('#openAchievement').onclick=()=>{
  ['achievementSport','achievementDistinction','achievementAgeGroup','achievementTeam','achievementSection','achievementEvent','achievementResult','achievementOrder','achievementNote'].forEach(id=>$('#'+id).value='');
  $('#achievementStatus').value='Действующий';
  $('#achievementRole').value='Участник';
  $('#achievementStudent').selectedIndex=0;
  $('#achievementStudent').innerHTML=students.map(student=>`<option value="${student.id}">${escapeHtml(student.name)}</option>`).join('');
  $('#achievementDate').value=todayLocal();
  $('#achievementDocument').value='';
  $('#achievementCategory').value='Спортивное звание (разряд)';
  fillCategoryFields('','Спортивное звание (разряд)');
  $('#achievementModal').hidden=false;
};
$('#achievementCategory').onchange=event=>fillCategoryFields('',event.target.value);
$('#editAchievementCategory').onchange=event=>fillCategoryFields('edit',event.target.value);
$('#saveAchievement').onclick=async()=>{
  try { await api('/api/achievements','POST',await readAchievementForm('achievement')); $('#achievementModal').hidden=true; await load(); toast('Запись добавлена.'); }
  catch(error) { toast(error.message); }
};
$('#editStudent').onclick=()=>{
  const student=students.find(item=>item.id===selectedStudentId);
  if(!student)return;
  $('#editStudentName').value=student.name;
  $('#editStudentBirth').value=isoDate(student.birth_date);
  $('#editStudentHealth').value=student.health || 'не указана';
  $('#editStudentAttendance').value=student.attendance;
  $('#editStudentAttendance').disabled=Number(student.attendance_records_count)>0;
  $('#editStudentAttendance').title=Number(student.attendance_records_count)>0?'Посещаемость рассчитывается по сохраненным занятиям.':'Нет отметок посещаемости; можно задать исходное значение.';
  $('#editStudentTheory').value=student.theory || 'не указано';
  $('#editStudentTheoryDate').value=isoDate(student.theory_date);
  $('#editStudentPractice').value=student.practice || 'не указано';
  $('#studentModal').hidden=true;
  $('#studentEditModal').hidden=false;
};
$('#saveStudentEdit').onclick=async()=>{
  const name=$('#editStudentName').value.trim(),attendance=Number($('#editStudentAttendance').value);
  if(name.split(/\s+/).length<2||!Number.isFinite(attendance)||attendance<0||attendance>100)return toast('Проверьте ФИО и посещаемость от 0 до 100.');
  try { await api(`/api/students/${selectedStudentId}`,'PUT',{name,health:$('#editStudentHealth').value,attendance,theory:$('#editStudentTheory').value,practice:$('#editStudentPractice').value,birth_date:$('#editStudentBirth').value,theory_date:$('#editStudentTheoryDate').value}); $('#studentEditModal').hidden=true; await load(); toast('Карточка студента сохранена.'); }
  catch(error) { toast(error.message); }
};
$('#saveAchievementEdit').onclick=async()=>{
  try { await api(`/api/achievements/${selectedAchievementId}`,'PUT',await readAchievementForm('editAchievement')); $('#achievementEditModal').hidden=true; await load(); toast('Изменения достижения сохранены.'); }
  catch(error) { toast(error.message); }
};
$('#addStudent').onclick=()=>$('#addStudentModal').hidden=false;
$('#saveStudent').onclick=async()=>{
  const name=$('#newStudentName').value.trim();
  if(name.split(/\s+/).length<2)return toast('Укажите фамилию и имя студента.');
  try { await api('/api/students','POST',{name,health:$('#newStudentHealth').value,group_code:activeGroup}); $('#addStudentModal').hidden=true; $('#newStudentName').value=''; await load(); toast('Студент добавлен.'); }
  catch(error) { toast(error.message); }
};
$('#exportReport').onclick=()=>{window.location.href=`/api/export.xlsx?group=${encodeURIComponent(activeGroup)}`;toast('Сводная ведомость подготовлена.')};
$('#guideStart').onclick=()=>{step=0;updateTour();};
$('#tourNext').onclick=()=>{step===tour.length-1?closeGuide():(step++,updateTour());};
$('#tourSkip').onclick=$('#closeTour').onclick=closeGuide;
addEventListener('resize',()=>!$('#tourMask').hidden&&placeTourSpotlight());
load().catch(error=>toast(error.message || 'Не удалось открыть локальную базу данных.'));
