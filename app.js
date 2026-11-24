let students = [];
let achievements = [];
let physicalTests = [];
let summary = {};
let activeGroup = localStorage.getItem('fkis-active-group') || '0905';
let selectedStudentId = null;
let selectedAchievementId = null;
let activeDiscipline = '';
let activeLessonType = '';
let studentFilter = 'all';
let selectedRole = 'Преподаватель кафедры ФВ';
let appSession = null;
let studentData = null;
const GTO_STAGE_LABELS=['I ступень (6–7 лет)','II ступень (8–9 лет)','III ступень (10–11 лет)','IV ступень (12–13 лет)','V ступень (14–15 лет)','VI ступень (16–17 лет)','VII ступень (18–19 лет)','VIII ступень (20–24 года)','IX ступень (25–29 лет)','X ступень (30–34 года)','XI ступень (35–39 лет)','XII ступень (40–44 года)','XIII ступень (45–49 лет)','XIV ступень (50–54 года)','XV ступень (55–59 лет)','XVI ступень (60–64 года)','XVII ступень (65–69 лет)','XVIII ступень (70 лет и старше)'];
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
function gtoStageFromBirth(birthDate, referenceDate=todayLocal()) {
  const birth=new Date(`${isoDate(birthDate)}T00:00:00`), reference=new Date(`${isoDate(referenceDate)}T00:00:00`);
  if(Number.isNaN(birth.getTime())||Number.isNaN(reference.getTime())||birth>reference)return '';
  let age=reference.getFullYear()-birth.getFullYear();
  if(reference.getMonth()<birth.getMonth()||(reference.getMonth()===birth.getMonth()&&reference.getDate()<birth.getDate()))age--;
  const bands=[[6,7],[8,9],[10,11],[12,13],[14,15],[16,17],[18,19],[20,24],[25,29],[30,34],[35,39],[40,44],[45,49],[50,54],[55,59],[60,64],[65,69],[70,150]];
  const index=bands.findIndex(([min,max])=>age>=min&&age<=max);
  return index<0?'':GTO_STAGE_LABELS[index];
}
function replaceGtoInput(id) {
  const input=$('#'+id);
  if(!input||input.tagName==='SELECT')return;
  const select=document.createElement('select'); select.id=id;
  select.innerHTML='<option value="">Выберите возрастную ступень</option>'+GTO_STAGE_LABELS.map(stage=>`<option>${escapeHtml(stage)}</option>`).join('');
  input.replaceWith(select);
}
function addStudentDocumentInput() {
  const grid=$('#studentSubmissionPanel .form-grid');
  if(!grid||$('#submissionDocument'))return;
  const label=document.createElement('label'); label.className='submission-field'; label.dataset.for='rank gto event'; label.hidden=true; label.textContent='Подтверждающий документ (PDF)';
  const input=document.createElement('input'); input.id='submissionDocument'; input.type='file'; input.accept='application/pdf,.pdf'; label.append(input); grid.append(label);
}
function addEventStatusFields() {
  for (const [id, className, before] of [
    ['achievementEventStatus','achievement-field','#achievementResult'],
    ['editAchievementEventStatus','edit-achievement-field','#editAchievementResult'],
    ['submissionEventStatus','submission-field','#submissionResult']
  ]) {
    if ($('#'+id)) continue;
    const label=document.createElement('label'); label.className=className; label.dataset.for='event'; label.hidden=true; label.textContent='Статус спортивного мероприятия';
    const input=document.createElement('input'); input.id=id; input.placeholder='Например, Спартакиада СПбГМТУ';
    label.append(input); $(before).parentElement.insertBefore(label,$(before));
  }
}
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
  if (c.includes('сборная')) return 'team';
  if (c.includes('секция') && !c.includes('сборная')) return 'section';
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
const workspaceSections = {
    "Преподаватель кафедры ФВ":[[
      ['attendance','Посещаемость занятий'], ['physical','Физическая подготовленность']
    ],[['dashboard','Обзор группы'],['students','Карточка студента'],['groupCard','Карточка группы'],['reports','Сводные данные']]],
    "Сотрудник ССК «Армада»":[[
      ['achievements','Спортивный разряд (звание)','rank'], ['achievements','ВФСК «ГТО»','gto'],
      ['achievements','Сборная команда','team'], ['achievements','Спортивная секция','section'],
      ['achievements','Спортивное мероприятие','event']
    ],[['students','Карточка студента'],['groupCard','Карточка группы'],['reports','Сводные данные']]],
    "Студент":[[
      ['studentPortal','ФИО, дата рождения и учебная группа','','submissionName'],
      ['studentPortal','Группа здоровья','','submissionHealth'],
      ['studentPortal','Спортивный разряд (звание)','','submissionPriorRank'],
      ['studentPortal','ВФСК «ГТО»','','submissionPriorGto'],
      ['studentPortal','Вид спорта до поступления в университет','','submissionSportBefore'],
      ['studentPortal','Адрес электронной почты','','submissionEmail'],
      ['studentPortal','Выбор элективной дисциплины ФКиС','','submissionElective'],
      ['studentPortal','Согласие на обработку персональных данных','','submissionConsent'],
      ['studentPortal','Подать спортивное достижение','','submissionCategory']
    ],[['studentPortal','Карточка студента']]],
    "Ответственный исполнитель кафедры ФВ":[[['approvals','Проверка заявок студентов'],['health','Группы здоровья']],[['reports','Сводные данные']]]
};
const studentSectionFields = {
  submissionName: ['submissionName','submissionBirth','submissionFaculty','submissionCourse','submissionGroup'],
  submissionHealth: ['submissionHealth','submissionHealthDocument'],
  submissionPriorRank: ['submissionPriorRank'],
  submissionPriorGto: ['submissionPriorGto'],
  submissionSportBefore: ['submissionSportBefore'],
  submissionEmail: ['submissionEmail'],
  submissionElective: ['submissionElective','submissionSemester'],
  submissionConsent: ['submissionConsent'],
  submissionCategory: ['submissionCategory']
};
let studentPortalRequest;
function showRole() {
  const [input, results] = workspaceSections[selectedRole];
  const openMode = [...$('#roleHomeActions').querySelectorAll('details')].findIndex(section=>section.open);
  $('#roleButton').textContent = selectedRole;
  $('#roleMenu').hidden = true;
  $('#roleButton').setAttribute('aria-expanded', 'false');
  $('#rolePicker').hidden = appSession.auth_enabled;
  $('#roleHomeTitle').textContent = selectedRole;
  $('#roleHomeActions').innerHTML = [
    ['ВВОД ДАННЫХ',input], ['РЕЗУЛЬТАТЫ',results]
  ].map(([title, actions], index)=>`<details name="role-workflow" class="panel role-mode"${index===openMode?' open':''}><summary>${title}</summary>
    <div class="role-home-actions">${actions.filter(([, , ,field])=>field !== 'submissionCategory' || studentData?.registered).map(([view,label,category,field])=>
      `<button class="role-action-card" data-go="${view}" data-mode="${index}" data-kind="${category||''}" data-field="${field||''}"><span>${escapeHtml(label)}</span><b>Открыть раздел →</b></button>`
    ).join('')}</div></details>`).join('');
  if ($('#addStudent')) $('#addStudent').hidden=selectedRole!=="Ответственный исполнитель кафедры ФВ";
}
function render() {
  const displayedGroup = window.groupDisplayName?.(activeGroup) || activeGroup;
  $('#studentsBody').innerHTML = students.map((student, index) => `<tr><td>${index + 1}</td><td><div class="student-cell"><span class="avatar">${escapeHtml(initials(student.name))}</span><div><b>${escapeHtml(student.name)}</b><small>${escapeHtml(displayedGroup)}${student.isu_id ? ` · ИСУ ${escapeHtml(student.isu_id)}` : ''}</small></div></div></td><td>${escapeHtml(student.health || 'не указана')}</td><td><span class="status ${Number(student.attendance) < 70 && Number(student.attendance) > 0 ? 'bad' : Number(student.attendance) >= 70 ? 'good' : 'warn'}">${Number(student.attendance) > 0 ? `${student.attendance}%` : 'нет данных'}</span></td><td><span class="status ${statusClass(student.theory)}">${escapeHtml(student.theory || 'не указано')}${student.theory_date ? `<small class="date-note">${displayDate(student.theory_date)}</small>` : ''}</span></td><td><span class="status ${statusClass(student.practice)}">${escapeHtml(student.practice || 'не указано')}</span></td><td><button class="detail-button" data-student="${student.id}">Карточка</button></td></tr>`).join('');
  $('#attendanceBody').innerHTML = students.map((student, index) => {
    const graded=activeLessonType==='Зачет с оценкой', credit=activeLessonType==='Зачет';
    return `<tr><td>${index + 1}</td><td><div class="student-cell"><span class="avatar">${escapeHtml(initials(student.name))}</span><b>${escapeHtml(student.name)}</b></div></td><td>${escapeHtml(student.health || 'не указана')}</td>${graded?`<td><select class="attendance-grade" data-grade-student="${student.id}"><option value="">Выберите оценку</option>${['Отлично','Хорошо','Удовлетворительно','Неудовлетворительно'].map(grade=>`<option ${student.grade===grade?'selected':''}>${grade}</option>`).join('')}</select></td>`:`<td><div class="attendance-toggle" data-id="${student.id}"><button class="${student.present ? 'on' : ''}" data-set="true">${credit?'Зачет':'Присутствовал'}</button><button class="${!student.present ? 'off' : ''}" data-set="false">${credit?'Не зачет':'Отсутствовал'}</button></div></td>`}</tr>`;
  }).join('');
  $('#healthBody').innerHTML=students.map((student,index)=>`<tr><td>${index+1}</td><td><b>${escapeHtml(student.name)}</b></td><td><select data-health-student="${student.id}" aria-label="Группа здоровья: ${escapeHtml(student.name)}"><option value="" ${!['основная','подготовительная','специальная'].includes(String(student.health).toLowerCase())?'selected':''}>Выберите группу здоровья</option>${['основная','подготовительная','специальная'].map(value=>`<option ${String(student.health).toLowerCase()===value?'selected':''}>${value}</option>`).join('')}</select></td><td><button class="detail-button" data-save-health="${student.id}">Сохранить</button></td></tr>`).join('')||'<tr><td colspan="4" class="empty-state">Список группы пуст.</td></tr>';
  $('#achievementBody').innerHTML = achievements.map(item => {
    const key = categoryKey(item.category);
    const sportOrEvent = key === 'rank' ? item.sport_type : key === 'team' ? item.team_name : key === 'section' ? item.sport_type : key === 'event' ? [item.details,item.event_status].filter(Boolean).join(' · ') : '';
    const distinction = key === 'gto' ? `${item.distinction || ''}${item.age_group ? ` · ${item.age_group}` : ''}` : key === 'rank' ? item.distinction : key === 'team' || key === 'section' ? item.status : [item.participant_role,item.event_result].filter(Boolean).join(' · ');
    return `<tr><td><b>${escapeHtml(item.name)}</b></td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(sportOrEvent || '—')}</td><td>${escapeHtml(distinction || item.details || '—')}</td><td>${escapeHtml(displayDate(item.record_date))}</td><td>${item.document_name ? `<a class="document-link" href="/api/achievement-document/${item.id}">${escapeHtml(item.document_name)}</a>` : '—'}</td><td><span class="status ${statusClass(item.status)}">${escapeHtml(item.status)}</span></td><td><button class="detail-button" data-achievement="${item.id}">Изменить</button></td></tr>`;
  }).join('');
  $('#attentionList').innerHTML = students.filter(student => Number(student.attendance) > 0 && Number(student.attendance) < 70).map(student => `<div class="attention-row"><span class="avatar">${escapeHtml(initials(student.name))}</span><div><b>${escapeHtml(shortName(student.name))}</b><small>${escapeHtml(window.groupDisplayName?.(activeGroup) || activeGroup)}</small></div><span class="attendance-score">${student.attendance}%</span></div>`).join('') || '<p class="empty-state">Нет студентов с посещаемостью ниже 70%.</p>';
  const studentOptions = students.map(student => `<option value="${student.id}" data-birth="${escapeHtml(student.birth_date||'')}">${escapeHtml(student.name)}</option>`).join('');
  $('#achievementStudent').innerHTML = studentOptions;
  $('#physicalStudent').innerHTML = studentOptions;
  $('#attendanceStudentCount').textContent = students.length;
  $('#studentListSummary').textContent = `${students.length} студентов · список из ИСУ`;
  $('#filterAll').textContent = `Все · ${students.length}`;
  $('#filterCredit').textContent = `Зачет · ${students.filter(s => s.practice === 'зачет').length}`;
  $('#filterAttention').textContent = `Внимание · ${students.filter(s => Number(s.attendance) > 0 && Number(s.attendance) < 70).length}`;
  renderPhysical();
  renderStats();
  renderGroupRoster();
  applyStudentFilter();
}
function renderGroupRoster() {
  $('#groupRosterBody').innerHTML=students.map((student,index)=>{
    const records=achievements.filter(item=>Number(item.student_id)===Number(student.id));
    const active=records.filter(item=>!['исключен','не действует'].includes(String(item.status).toLowerCase()));
    const teams=active.filter(item=>categoryKey(item.category)==='team').map(item=>item.team_name||item.details).filter(Boolean);
    const gto=active.filter(item=>categoryKey(item.category)==='gto').map(item=>item.distinction).filter(Boolean);
    const ranks=active.filter(item=>categoryKey(item.category)==='rank').map(item=>item.distinction).filter(Boolean);
    const events=records.filter(item=>categoryKey(item.category)==='event');
    const achievement=events.map(item=>[item.details,item.event_result||item.participant_role].filter(Boolean).join(': ')).filter(Boolean);
    const initialsName=student.name.split(/\s+/).map((part,i)=>i?`${part[0]}.`:part).join(' ');
    return `<tr><td>${index+1}</td><td><button class="detail-button" data-student="${student.id}">${escapeHtml(initialsName)}</button></td><td>${escapeHtml(student.health||'не указана')}</td><td>${escapeHtml(student.theory||'не указано')}</td><td>${escapeHtml(student.practice||'не указано')}</td><td>не указано</td><td>${escapeHtml(teams.join(', ')||'—')}</td><td>${escapeHtml(gto.join(', ')||'—')}</td><td>${escapeHtml(ranks.join(', ')||'—')}</td><td>${escapeHtml(achievement.join('; ')||'—')}</td><td>${events.filter(item=>item.participant_role==='Участник').length}</td><td>${events.filter(item=>item.participant_role==='Волонтер').length}</td></tr>`;
  }).join('')||'<tr><td colspan="12" class="empty-state">Список группы пуст.</td></tr>';
}
function renderPhysical() {
  const position = new Map(students.map((student, index) => [student.id, index + 1]));
  $('#physicalBody').innerHTML = physicalTests.map(item => `<tr><td>${position.get(item.student_id) || '—'}</td><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.test_category||'не указано')}</td><td>${escapeHtml(item.exercise)}</td><td>${escapeHtml(item.result)}</td><td>${escapeHtml(item.grade || 'Нет норматива')}</td><td>${escapeHtml(displayDate(item.record_date))}</td><td><button class="detail-button" data-physical="${item.id}">Изменить</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty-state">Результаты испытаний пока не внесены.</td></tr>';
}
function renderStats() {
  const total = students.length;
  const avg = total ? Math.round(students.reduce((sum, student) => sum + Number(student.attendance || 0), 0) / total) : 0;
  const attendanceHasData = Number(summary.attendance?.lessons || 0) > 0;
  const practice = students.filter(student => student.practice === 'зачет').length;
  const pct = value => total ? `${Math.round(value / total * 100)}%` : '—';
  $('#metricStudents').textContent = total;
  $('#metricAttendance').textContent = attendanceHasData ? `${avg}%` : '—';
  $('#metricCredit').textContent = students.some(student => student.practice !== 'не указано') ? `${practice} / ${total}` : '—';
  $('#metricCreditShare').textContent = students.some(student => student.practice !== 'не указано') ? `${pct(practice)} группы` : 'оценки еще не внесены';
  $('#metricAttention').textContent = students.filter(student => Number(student.attendance) > 0 && Number(student.attendance) < 70).length;
  const bars = (window.attendanceTrend || []).slice(0, 7).reverse();
  $('#attendanceBars').innerHTML = bars.length ? bars.map(row => {
    const percent = row.total ? Math.round(row.present / row.total * 100) : 0;
    return `<div title="${escapeHtml(displayDate(row.lesson_date))}: ${percent}%"><i style="height:${Math.max(3,percent)}%"></i><span>${escapeHtml(displayDate(row.lesson_date).slice(0,5))}</span></div>`;
  }).join('') : '<p class="empty-state">График появится после сохранения отметок посещаемости.</p>';
}
async function renderConsolidated() {
  const executor = selectedRole === 'Ответственный исполнитель кафедры ФВ';
  $('#consolidatedBody').closest('article').hidden = executor;
  $('#exportReport').hidden = executor;
  $('#groupHealthSummary').hidden = !executor;
  if (executor) {
    const {rows} = await api('/api/group-health-summary');
    $('#groupHealthSummary tbody').innerHTML = rows.map(row=>`<tr>${[row.faculty,row.group_name,row.health,row.elective,row.total].map(value=>`<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="5" class="empty-state">Группы пока не загружены.</td></tr>';
    return;
  }
  const {rows}=await api('/api/consolidated');
  $('#consolidatedBody').innerHTML=rows.map(row=>`<tr class="summary-${escapeHtml(row.level)}">${[row.label,row.total,row.main_health,row.prep_health,row.special_health,row.theory_credit,row.theory_no_credit,row.practice_credit,row.practice_no_credit,row.overall_grade||'—',row.teams,row.gto_gold,row.gto_silver,row.gto_bronze,row.gto_none,row.ms,row.kms,row.rank1,row.rank2,row.rank3,row.rank_none,row.sport_achievements,row.participants,row.volunteers].map(value=>`<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="24" class="empty-state">Данных пока нет.</td></tr>';
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
  const attendanceQuery=activeDiscipline&&activeLessonType?`&discipline=${encodeURIComponent(activeDiscipline)}&lesson_type=${encodeURIComponent(activeLessonType)}`:'';
  const data = await api(`/api/bootstrap?group=${encodeURIComponent(activeGroup)}&date=${encodeURIComponent(dateValue)}${attendanceQuery}`);
  activeGroup = data.group || activeGroup;
  const attendanceMap = new Map((data.attendance_records || []).map(row => [Number(row.student_id),row]));
  students = (data.students || []).map(student => ({...student,attendance:student.computed_attendance ?? student.attendance,present:Number(attendanceMap.get(Number(student.id))?.present || 0)===1,grade:attendanceMap.get(Number(student.id))?.grade||''}));
  achievements = data.achievements || [];
  physicalTests = data.physical_tests || [];
  summary = data.summary || {};
  $('#groupOrganizerName').value=data.sports_organizer||'';
  window.attendanceTrend = data.attendance_trend || [];
  updateGroupLabels();
  render();
}
async function loadStudentPortal() {
  const [data,mine,groups]=await Promise.all([api('/api/student-data'),api('/api/my-submissions'),api('/api/registration-groups')]);
  studentData=data;
  const groupSelect=$('#submissionGroup');
  if (groupSelect.options.length<=1) {
    groupSelect.replaceChildren(new Option('Выберите учебную группу',''), ...groups.groups.map(group=>
      new Option(group.display_code,group.group_code)));
    groupSelect.onchange = () => {
      const group = groups.groups.find(item=>item.group_code === groupSelect.value);
      if (group?.faculty) $('#submissionFaculty').value = group.faculty;
      if (group?.course) $('#submissionCourse').value = group.course;
    };
  }
  const profile=data.draft?.payload || (data.registered ? data.student : data.submission?.payload) || {};
  $('#submissionEmail').value = appSession.username || '';
  $('#submissionSemester').value = profile.elective_semester || '';
  $('#submissionPriorRank').value = profile.prior_rank || '';
  $('#submissionPriorGto').value = profile.prior_gto || '';
  if(profile.name)$('#submissionName').value=profile.name;
  if(profile.birth_date)$('#submissionBirth').value=isoDate(profile.birth_date);
  if(profile.faculty)$('#submissionFaculty').value=profile.faculty;
  if(profile.course)$('#submissionCourse').value=profile.course;
  if(profile.group_code)groupSelect.value=profile.group_code;
  $('#submissionHealth').value = profile.health || 'не указана';
  $('#submissionSportBefore').value = profile.sport_before || '';
  $('#submissionElective').value = profile.elective || '';
  $('#submissionConsent').checked = !!profile.personal_data_consent;
  if(profile.birth_date)$('#submissionAgeGroup').value=gtoStageFromBirth(profile.birth_date,$('#submissionDate').value||todayLocal());
  if(!$('#submissionDate').value)$('#submissionDate').value=todayLocal();
  const returned = data.draft || (data.submission?.status === 'Отклонено' ? data.submission : null);
  $('#existingHealthCertificate').hidden = !returned?.has_health_document;
  $('#studentPortalStatus').textContent = returned
    ? `Заявка возвращена на редактирование: ${returned.review_note || 'исправьте сведения и отправьте повторно'}`
    : data.registered ? `Подтвержденный профиль · ${data.student.display_code || data.student.group_code}`
    : 'Профиль ожидает проверки ответственным исполнителем.';
  data.achievements ||= [];
  data.physical_tests ||= [];
  const events=data.achievements.filter(item=>categoryKey(item.category)==='event');
  const ranks=data.achievements.filter(item=>categoryKey(item.category)==='rank');
  const gto=data.achievements.filter(item=>categoryKey(item.category)==='gto');
  const teams=data.achievements.filter(item=>categoryKey(item.category)==='team'&&item.status!=='Исключен');
  const sections=data.achievements.filter(item=>categoryKey(item.category)==='section'&&item.status!=='Исключен');
  const achievementDetails=data.achievements.map(item=>`<li>${escapeHtml(item.category)}: ${escapeHtml(item.details||item.distinction||item.team_name||item.sport_type||'запись')} · ${escapeHtml(item.status||'')}</li>`).join('');
  const eventDetails=events.map(item=>`<li>${escapeHtml(item.details||'Мероприятие')} · ${escapeHtml(item.event_status||'статус не указан')} · ${escapeHtml(item.participant_role||'роль не указана')} · ${escapeHtml(item.event_result||'результат не указан')} · ${escapeHtml(displayDate(item.record_date))}</li>`).join('');
  $('#studentCardData').innerHTML=data.registered?`<div class="detail-grid"><div><span>ФИО</span><b>${escapeHtml(data.student.name)}</b></div><div><span>Дата рождения</span><b>${escapeHtml(displayDate(data.student.birth_date))}</b></div><div><span>Учебная группа</span><b>${escapeHtml(data.student.display_code||data.student.group_code)}</b></div><div><span>Группа здоровья</span><b>${escapeHtml(data.student.health||'не указана')}</b></div><div><span>ВФСК «ГТО»</span><b>${escapeHtml(gto.map(item=>item.distinction).filter(Boolean).join(', ')||'отсутствует')}</b></div><div><span>Спортивное звание (разряд)</span><b>${escapeHtml(ranks.map(item=>item.distinction).filter(Boolean).join(', ')||'отсутствует')}</b></div><div><span>Теория и методика ФКиС</span><b>${escapeHtml(data.student.theory||'не указано')} · дата: ${escapeHtml(displayDate(data.student.theory_date)||'не указана')}</b></div><div><span>Посещаемость ФКиС</span><b>${Number(data.attendance?.present||0)} из ${Number(data.attendance?.total||0)} занятий посещено · критерий процента и баллов не задан</b></div><div><span>Практика ФКиС</span><b>${escapeHtml(data.student.practice||'не указано')}</b></div><div><span>Физическая подготовленность</span><b>${data.physical_tests.map(item=>`${escapeHtml(item.test_category||'группа не указана')} · ${escapeHtml(item.exercise)}: ${escapeHtml(item.result)} (${escapeHtml(item.grade||'норматив не загружен')})`).join('<br>')||'результатов пока нет'}</b></div><div><span>Сборная команда</span><b>${teams.length} · ${escapeHtml(teams.map(item=>item.team_name||'участник').join(', ')||'отсутствует')} · процент и баллы не заданы</b></div><div><span>Спортивная секция</span><b>${sections.length} · ${escapeHtml(sections.map(item=>item.sport_type||'участник').join(', ')||'отсутствует')} · процент и баллы не заданы</b></div><div><span>Участие спортсменом / волонтером</span><b>${events.filter(item=>item.participant_role==='Участник').length} / ${events.filter(item=>item.participant_role==='Волонтер').length} · баллы не заданы<details><summary>Список мероприятий</summary><ul>${eventDetails||'<li>Записей нет.</li>'}</ul></details></b></div><div class="full-detail"><span>Спортивные достижения</span><ul>${achievementDetails||'<li>Нет подтвержденных записей</li>'}</ul></div></div>`:'<p class="empty-state">Карточка появится после подтверждения заявки.</p>';
  if(data.registered){
    const grid=$('#studentCardData .detail-grid');
    const attendanceField=[...grid.children].find(node=>node.querySelector('span')?.textContent==='Посещаемость ФКиС');
    if(attendanceField)attendanceField.querySelector('b').textContent=`${Number(data.attendance?.present||0)} из ${Number(data.attendance?.total||0)} отмеченных занятий · % от обязательного количества не задан`;
    const electives = Object.entries(data.electives || {}).map(([term, choice])=>`${term} семестр — ${choice}`).join(' · ');
    for(const [label,value] of [['Адрес электронной почты',appSession.username],['Вид спорта до поступления',data.student.sport_before||'не указан'],['Элективные дисциплины ФКиС',electives||data.student.elective||'не указана'],['Разряд до поступления',data.student.prior_rank||'не указан'],['ГТО до поступления',data.student.prior_gto||'не указано']]){
      const field=document.createElement('div');field.innerHTML=`<span>${label}</span><b>${escapeHtml(value)}</b>`;grid.insertBefore(field,grid.querySelector('.full-detail'));
    }
    grid.querySelectorAll('div').forEach(field=>{if(field.querySelector('span')?.textContent==='Физическая подготовленность'){field.querySelector('b').innerHTML=data.physical_tests.map(item=>`${escapeHtml(item.test_category||'группа не указана')} · ${escapeHtml(item.exercise)}: ${escapeHtml(item.result)} (${escapeHtml(item.grade||'норматив не загружен')})`).join('<br>')||'результатов пока нет';}});
  }
  $('#mySubmissionList').innerHTML=mine.submissions.map(item=>`<div class="approval-card"><b>${escapeHtml(item.status)}</b><span>${escapeHtml(displayDate(item.created_at))}</span>${item.review_note?`<p>${escapeHtml(item.review_note)}</p>`:''}</div>`).join('')||'<p class="empty-state">Отправленных заявок пока нет.</p>';
}
function openStudentSection(mode, field) {
  const panel = $('#studentSubmissionPanel');
  const results = mode === '1';
  panel.hidden = results;
  $('#studentCardData').closest('article').hidden = !results;
  $('#studentPortal h1').textContent = results ? 'Карточка студента' :
    workspaceSections['Студент'][0].find(action=>action[3]===field)?.[1] || 'Ввод данных';
  if (results) return;
  const activeFields = studentSectionFields[field || 'submissionName'];
  for (const label of panel.querySelector('.form-grid').children) {
    if (!label.classList.contains('submission-field')) label.hidden = !activeFields.includes(label.querySelector('input,select')?.id);
  }
  const category = $('#submissionCategory');
  if (field !== 'submissionCategory') category.value = '';
  category.dispatchEvent(new Event('change'));
  $('#submitStudentData').hidden = field === 'submissionEmail';
  $('#submitStudentData').disabled = !studentData;
  $('#studentSubmissionPanel h2').hidden = true;
  $('#studentSubmissionPanel .eyebrow').hidden = true;
}
async function loadApprovals() {
  const {submissions}=await api('/api/pending-submissions');
  $('#approvalList').innerHTML=submissions.map(item=>{
    const p=item.payload||{};
    const profile = p.kind === 'profile' ? [
      ['Группа',item.group_name||p.group_code], ['Факультет',p.faculty], ['Курс',p.course],
      ['Дата рождения',displayDate(p.birth_date)], ['Группа здоровья',p.health],
      ['Вид спорта до поступления',p.sport_before], ['Разряд до поступления',p.prior_rank],
      ['ГТО до поступления',p.prior_gto], ['Элективная дисциплина',p.elective],
      ['Семестр',p.elective_semester], ['Согласие на обработку',p.personal_data_consent?'Дано':'—']
    ] : [];
    const fields = [['Электронная почта',item.email], ...profile,
      ['Достижение', [p.category,p.distinction,p.sport_type,p.age_group,p.team_name,p.section,p.event_name,p.event_status,p.participant_role,p.event_result].filter(Boolean).join(' · ')]];
    const details = fields.filter(([,value])=>value).map(([label,value])=>`<div><span>${label}</span><b>${escapeHtml(value)}</b></div>`).join('');
    const pdf = `/api/submission-document/${item.id}`;
    return `<article class="panel approval-card"><p class="eyebrow">Заявка №${item.id} · ${escapeHtml(displayDate(item.created_at))}</p><h2>${escapeHtml(p.name||p.category||'Данные студента')}</h2><div class="detail-grid">${details}${item.has_health_document?`<div><a href="${pdf}?kind=health">Скачать справку о группе здоровья</a></div>`:''}${item.has_document?`<div><a href="${pdf}">Скачать документ о достижении</a></div>`:''}</div><label>Комментарий (обязателен при отклонении)<textarea id="review-note-${item.id}" rows="2"></textarea></label><div class="modal-actions"><button class="secondary-button" data-review="${item.id}" data-status="Отклонено">Вернуть студенту</button><button class="primary-button" data-review="${item.id}" data-status="Подтверждено">Подтвердить</button></div></article>`;
  }).join('')||'<article class="panel empty-state">Новых заявок на проверку нет.</article>';
}
async function initializeApp() {
  const profileFields = $('#studentSubmissionPanel .form-grid');
  $('#submissionHealth').add(new Option('не указана','не указана'), 0);
  profileFields.insertAdjacentHTML('afterbegin', '<label>Адрес электронной почты<input id="submissionEmail" type="email" readonly></label>');
  $('#submissionElective').parentElement.insertAdjacentHTML('afterend', `<label>Семестр элективной дисциплины<select id="submissionSemester"><option value="">Выберите семестр</option>${Array.from({length:11},(_,i)=>`<option value="${i+2}">${i+2} семестр</option>`).join('')}</select></label>
    <label>Спортивный разряд до поступления<select id="submissionPriorRank"><option value="">Не указано</option><option>б/р</option><option>Третий разряд</option><option>Второй разряд</option><option>Первый разряд</option><option>Кандидат в мастера спорта</option><option>Мастер спорта</option></select></label>
    <label>Знак ГТО до поступления<select id="submissionPriorGto"><option value="">Не указано</option><option>Золотой знак</option><option>Серебряный знак</option><option>Бронзовый знак</option></select></label>
    <label>Справка о группе здоровья (PDF)<input id="submissionHealthDocument" type="file" accept="application/pdf,.pdf"><small id="existingHealthCertificate" hidden>Прежняя справка сохранится, если группа здоровья не изменилась.</small></label>`);
  ['achievementAgeGroup','editAchievementAgeGroup','submissionAgeGroup'].forEach(replaceGtoInput);
  addStudentDocumentInput();
  addEventStatusFields();
  $('#submissionDate').value=todayLocal();
  $('#submissionBirth').addEventListener('change',()=>{const stage=gtoStageFromBirth($('#submissionBirth').value);if(stage)$('#submissionAgeGroup').value=stage;});
  $('#achievementStudent').addEventListener('change',()=>{const option=$('#achievementStudent').selectedOptions[0];$('#achievementAgeGroup').value=gtoStageFromBirth(option?.dataset.birth,$('#achievementDate').value)||'';});
  $('#achievementDate').addEventListener('change',()=>{const option=$('#achievementStudent').selectedOptions[0];$('#achievementAgeGroup').value=gtoStageFromBirth(option?.dataset.birth,$('#achievementDate').value)||'';});
  $('#editAchievementStudent').addEventListener('change',()=>{const option=$('#editAchievementStudent').selectedOptions[0];$('#editAchievementAgeGroup').value=gtoStageFromBirth(option?.dataset.birth,$('#editAchievementDate').value)||'';});
  appSession=await api('/api/session');
  if (appSession.auth_enabled && !appSession.authenticated) {
    location.replace('/login');
    return;
  }
  if (!workspaceSections[appSession.role]) throw new Error('Не удалось определить роль.');
  selectedRole=appSession.role;
  const signOut=$('#signOut');
  signOut.hidden=!appSession.authenticated;
  signOut.onclick=async()=>{await fetch('/api/logout',{method:'POST'});location.assign('/login');};
  showRole(); go('roleHome');
  $('#workspaceLoading').hidden = true;
  if(selectedRole==='Студент') {
    studentPortalRequest = loadStudentPortal().then(()=>{
      if (studentData.registered) showRole();
    }).catch(()=>{});
  } else {
    load().catch(error=>toast(error.message));
  }
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
  activeLessonType = '';
  $('#disciplineSelect').value = '';
  $('#confirmDiscipline').disabled = true;
  $('#lessonTopic').value = '';
  $('#lessonTopic').innerHTML='<option value="">Выберите занятие</option>';
  $('#attendanceStatusHeading').hidden = false;
  $('#attendanceGradeHeading').hidden = true;
  $('#attendanceSetup').hidden = false;
  $('#attendanceJournal').hidden = true;
  $('#saveAttendance').hidden = true;
  $('#attendanceSubtitle').innerHTML = `Группа <span data-group-label>${escapeHtml(window.groupDisplayName?.(activeGroup) || activeGroup)}</span> · выберите дисциплину`;
}
function go(view, mode, field) {
  if (!appSession || (view !== 'roleHome' && !workspaceSections[selectedRole].flat().some(([section])=>section===view))) return;
  document.querySelectorAll('.view').forEach(section => section.classList.toggle('active-view', section.id === view));
  $('#workspaceReturn').hidden = view === 'roleHome';
  $('#groupPickerRow').hidden = !['dashboard','students','attendance','physical','achievements','groupCard','health'].includes(view);
  if (view === 'attendance') resetAttendanceFlow();
  if (view === 'reports') renderConsolidated().catch(error=>toast(error.message));
  if (view === 'approvals') loadApprovals().catch(error=>toast(error.message));
  if (view === 'studentPortal') {
    openStudentSection(mode, field);
    if (!studentData) {
      const loading = studentPortalRequest || Promise.resolve();
      loading.then(async()=>{
        if (!studentData) await loadStudentPortal();
        $('#submitStudentData').disabled = false;
      }).catch(error=>toast(error.message));
    }
  }
  scrollTo({top:0,behavior:'smooth'});
  if (field) requestAnimationFrame(() => {
    const input = document.getElementById(field);
    input?.focus({preventScroll:true});
    input?.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
}
function studentCard(id) {
  const student = students.find(item => item.id === Number(id));
  if (!student) return;
  selectedStudentId = student.id;
  const records = achievements.filter(item => item.student_id === student.id);
  const physical = physicalTests.filter(item => item.student_id === student.id);
  const events=records.filter(item=>categoryKey(item.category)==='event');
  const rank=records.filter(item=>categoryKey(item.category)==='rank');
  const gto=records.filter(item=>categoryKey(item.category)==='gto');
  const teams=records.filter(item=>categoryKey(item.category)==='team'&&item.status!=='Исключен');
  const sections=records.filter(item=>categoryKey(item.category)==='section'&&item.status!=='Исключен');
  const eventList=role=>{const matches=events.filter(item=>item.participant_role===role);return `<details><summary>${matches.length} ${role==='Участник'?'участий спортсменом':'волонтерств'}</summary>${matches.length?matches.map(item=>`<p>${escapeHtml(item.details||'Мероприятие')} · ${escapeHtml(item.event_status||'статус не указан')} · ${escapeHtml(item.event_result||'результат не указан')} · ${escapeHtml(displayDate(item.record_date))}</p>`).join(''):'<p>Записей нет.</p>'}</details>`;};
  $('#modalStudentName').textContent = student.name;
  $('#studentDetails').innerHTML = `<div class="detail-grid">
    <div><span>Учебная группа (ИСУ)</span><b>${escapeHtml(window.groupDisplayName?.(activeGroup) || activeGroup)}</b></div>
    <div><span>ISU ID</span><b>${escapeHtml(student.isu_id || 'не получен')}</b></div>
    <div><span>Номер зачетной книжки</span><b>${escapeHtml(student.enrollment_number || 'не получен')}</b></div>
    <div><span>Дата рождения</span><b>${escapeHtml(displayDate(student.birth_date) === '—' ? '' : displayDate(student.birth_date)) || 'не получена из выгрузки'}</b></div>
    <div><span>Группа здоровья</span><b>${escapeHtml(student.health || 'не указана')}</b></div>
    <div><span>ТиМ ФКиС</span><b>${escapeHtml(student.theory || 'не указано')}${student.theory_date ? ` · ${escapeHtml(displayDate(student.theory_date))}` : ''}</b></div>
    <div><span>Посещаемость ФКиС</span><b>${Number(student.attendance_present_count||0)} из ${Number(student.attendance_records_count||0)} занятий посещено · процент от обязательного количества и дополнительные баллы не заданы</b></div>
    <div><span>Вид спорта до поступления</span><b>${escapeHtml(student.sport_before||'не указан')}</b></div>
    <div><span>Элективная дисциплина ФКиС</span><b>${escapeHtml(student.elective||'не указана')}</b></div>
    <div><span>Практика ФКиС</span><b>${escapeHtml(student.practice || 'не указано')}</b></div>
    <div><span>ВФСК «ГТО»</span><b>${escapeHtml(gto.map(item=>item.distinction||item.category).join(', ')||'отсутствует')}</b></div>
    <div><span>Спортивное звание (разряд)</span><b>${escapeHtml(rank.map(item=>item.distinction).filter(Boolean).join(', ')||'отсутствует')}</b></div>
    <div><span>Сборная команда</span><b>${teams.length} · ${escapeHtml(teams.map(item=>item.team_name||'участник').join(', ')||'отсутствует')} · процент и баллы не заданы</b></div>
    <div><span>Спортивная секция</span><b>${sections.length} · ${escapeHtml(sections.map(item=>item.sport_type||'участник').join(', ')||'отсутствует')} · процент и баллы не заданы</b></div>
    <div><span>Физическая подготовленность</span><b>${physical.length ? physical.map(item=>`${escapeHtml(item.test_category||'группа не указана')} · ${escapeHtml(item.exercise)}: ${escapeHtml(item.result)} (${escapeHtml(item.grade||'оценка по нормативу не загружена')})`).join('<br>') : 'результатов пока нет'}</b></div>
    <div><span>Зачет и дополнительные баллы за посещаемость</span><b>Не рассчитываются: нет утвержденного критерия и правил начисления</b></div>
    <div><span>Спортивные мероприятия</span><b>${eventList('Участник')}${eventList('Волонтер')}</b></div>
    <div><span>Спортивные достижения</span><b>${records.length ? records.map(item=>`${escapeHtml(item.category)}: ${escapeHtml(item.details||item.distinction||item.team_name||item.sport_type||'запись')}`).join('<br>') : 'нет подтвержденных записей'}</b></div>
  </div>`;
  $('#studentModal').hidden = false;
}
function fillCategoryFields(prefix, category) {
  const key = categoryKey(category);
  const formPrefix = prefix ? 'editAchievement' : 'achievement';
  filterAchievementChoices(key, $(`#${formPrefix}Distinction`), $(`#${formPrefix}Status`));
  document.querySelectorAll(prefix ? '.edit-achievement-field' : '.achievement-field').forEach(field => {
    field.hidden = !field.dataset.for.split(/\s+/).includes(key);
  });
  const eventStatus = $(`#${prefix ? 'editAchievementEventStatus' : 'achievementEventStatus'}`);
  if (eventStatus) eventStatus.required = key === 'event';
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
  const eventStatus = formValue(prefix, 'EventStatus');
  const dateValue = formValue(prefix, 'Date') || todayLocal();
  if (!studentId) throw new Error('Выберите студента из списка.');
  if (key === 'rank' && (!sportType || !distinction)) throw new Error('Укажите вид спорта и спортивное звание или разряд.');
  if (key === 'gto' && (!ageGroup || !distinction)) throw new Error('Укажите возрастную ступень и знак ГТО.');
  if (key === 'team' && !teamName) throw new Error('Укажите название сборной команды.');
  if (key === 'section' && !section) throw new Error('Укажите название спортивной секции.');
  if (key === 'event' && !eventName) throw new Error('Укажите наименование спортивного мероприятия.');
  if (key === 'event' && !eventStatus) throw new Error('Укажите статус спортивного мероприятия.');
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
      status:formValue(prefix,'Status'), sport_type:key==='rank'?sportType:key==='section'?section:'', distinction:key==='rank'||key==='gto'?distinction:'', age_group:key==='gto'?ageGroup:'',
      order_basis:formValue(prefix,'Order'), participant_role:key==='event'?role:'',
      event_result:key==='event'?eventResult:'', event_status:key==='event'?eventStatus:'', note:key==='event'?formValue(prefix,'Note'):'', team_name:key==='team'?teamName:'',
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
  $('#editAchievementEventStatus').value = item.event_status || '';
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
  go(item.view,item.mode,item.field);
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
let tour = [];
const tourByRole = {
  "Преподаватель кафедры ФВ":[
    {view:'dashboard',target:'.metric-grid',title:'Рабочее место преподавателя',text:'На главном экране видны выбранная группа, посещаемость и данные, требующие внимания.'},
    {view:'students',target:'#studentsBody',title:'Карточки студентов',text:'Откройте список группы и карточку студента. Данные списка доступны для просмотра.'},
    {view:'attendance',target:'#attendanceSetup',title:'Журнал посещаемости',text:'Выберите дисциплину, подтвердите, затем выберите тип занятия и отметьте студентов. Для зачета доступны «Зачет/Не зачет», для зачета с оценкой — оценочная шкала.'},
    {view:'physical',target:'.physical-setup',title:'Физическая подготовленность',text:'Выберите студента, упражнение, дату и внесите результат. Оценка появится после загрузки нормативной таблицы.'}
  ],
  "Сотрудник ССК «Армада»":[{view:'achievements',target:'.achievement-tabs',title:'Спортивные достижения',text:'Ведите разряды, ГТО, сборные команды, спортивные секции и мероприятия. Поля меняются в зависимости от раздела.'},{view:'groupCard',target:'#groupRosterBody',title:'Карточка группы',text:'Ведомость показывает состав группы и подтвержденные показатели учета.'}],
  "Ответственный исполнитель кафедры ФВ":[{view:'approvals',target:'#approvalList',title:'Проверка заявок',text:'Подтвердите данные студента или верните их на исправление с причиной. Студент увидит решение в личном кабинете; письмо отправится при настроенном SMTP.'},{view:'health',target:'#healthBody',title:'Группа здоровья',text:'Выберите категорию здоровья для студента и сохраните изменение.'},{view:'reports',target:'#consolidatedBody',title:'Сводные данные',text:'Отчет сгруппирован по курсам и содержит только числовые показатели, без ФИО.'}],
  "Студент":[{view:'studentPortal',mode:'0',field:'submissionName',target:'#studentSubmissionPanel',title:'Ввод данных студентом',text:'Заполните разделы профиля на рабочем месте и отправьте их одной заявкой.'},{view:'studentPortal',mode:'1',target:'#mySubmissionList',title:'Результаты и решения',text:'В карточке отображаются подтвержденные данные и причины возврата заявок на исправление.'}]
};
const defaultTour = [
  {view:'dashboard',target:'.metric-grid',title:'Карточка группы',text:'Сводные показатели пересчитываются по выбранной группе и сохраненным данным.'},
  {view:'students',target:'#studentsBody',title:'Список студентов',text:'Состав загружен из списка ИСУ. Откройте карточку, чтобы просмотреть и изменить данные студента.'},
  {view:'attendance',target:'#attendanceSetup',title:'Посещаемость',text:'Сначала выберите дисциплину и подтвердите выбор. Затем установите дату, отметьте каждого студента и сохраните журнал.'},
  {view:'physical',target:'.physical-setup',title:'Физическая подготовленность',text:'Выберите студента, дату и испытание. Запишите результат. Повторная запись того же упражнения за эту дату обновится.'},
  {view:'achievements',target:'.achievement-tabs',title:'Спортивные достижения',text:'Ведите спортивные разряды, ГТО, членство в сборной или секции и участие в мероприятиях. К записи можно приложить подтверждающий PDF.'},
  {view:'groupCard',target:'#groupRosterBody',title:'Карточка группы',text:'Ведомость показывает состав группы и подтвержденные показатели учета.'},
  {view:'reports',target:'#consolidatedBody',title:'Сводные данные',text:'Отчет сгруппирован по курсам и содержит только числовые показатели, без ФИО студентов.'}
];
let step = 0;

document.addEventListener('click', async event => {
  const goButton = event.target.closest('[data-go]');
  const studentButton = event.target.closest('[data-student]');
  const achievementButton = event.target.closest('[data-achievement]');
  const physicalButton = event.target.closest('[data-physical]');
  const filter = event.target.closest('[data-student-filter]');
  const closeButton = event.target.closest('[data-close]');
  const attendanceButton = event.target.closest('[data-set]');
  const roleChoice = event.target.closest('[data-role]');
  const reviewButton = event.target.closest('[data-review]');
  const healthSave = event.target.closest('[data-save-health]');
  if (goButton) {
    go(goButton.dataset.go, goButton.dataset.mode, goButton.dataset.field);
    if (goButton.dataset.kind) {
      $(`[data-achievement-filter="${goButton.dataset.kind}"]`).click();
      openAchievementForm(goButton.dataset.kind);
    }
  }
  if (studentButton) studentCard(studentButton.dataset.student);
  if(healthSave){const studentId=Number(healthSave.dataset.saveHealth),health=$(`[data-health-student="${studentId}"]`).value;if(!health)return toast('Выберите группу здоровья.');try{await api('/api/student-health','PUT',{student_id:studentId,health});await load();toast('Группа здоровья сохранена.')}catch(error){toast(error.message)}}
  if (achievementButton) editAchievement(achievementButton.dataset.achievement);
  if (physicalButton) {
    const item=physicalTests.find(record=>record.id===Number(physicalButton.dataset.physical));
    if(item){$('#physicalStudent').value=item.student_id;$('#physicalDate').value=isoDate(item.record_date)||item.record_date;$('#physicalCategory').value=item.test_category||'';$('#physicalExercise').value=item.exercise;$('#physicalResult').value=item.result;$('#physicalExercise').focus();scrollTo({top:0,behavior:'smooth'});}
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
  if (roleChoice) {
    try { await api('/api/demo-role','POST',{role:roleChoice.dataset.role}); location.reload(); }
    catch(error){toast(error.message);}
  }
  if (reviewButton) {
    const status=reviewButton.dataset.status,note=$(`#review-note-${reviewButton.dataset.review}`).value.trim();
    try { const result=await api(`/api/review-submission/${reviewButton.dataset.review}`,'POST',{status,note}); await loadApprovals(); toast(result.email_sent?'Решение сохранено, уведомление отправлено по почте.':'Решение сохранено; студент увидит его в личном кабинете.'); }
    catch(error){toast(error.message);}
  }
  if (!event.target.closest('.role-picker') && $('#roleMenu')) { $('#roleMenu').hidden=true; $('#roleButton').setAttribute('aria-expanded','false'); }
});
$('#studentSearch').addEventListener('input',applyStudentSearch);
$('#roleButton').onclick=()=>{const menu=$('#roleMenu');menu.hidden=!menu.hidden;$('#roleButton').setAttribute('aria-expanded',String(!menu.hidden));};
$('#disciplineSelect').addEventListener('change',()=>$('#confirmDiscipline').disabled=!$('#disciplineSelect').value);
$('#confirmDiscipline').onclick=async()=>{
  const discipline=$('#disciplineSelect').value;
  if(!discipline)return toast('Сначала выберите дисциплину.');
  activeDiscipline=discipline;
  const types=discipline==='Элективная физическая культура и спорт'?['Общая физическая подготовка','Плавание','Единоборства','Фитнес (акробатика и т.п.)','Зачет']:['Лекция 1','Лекция 2','Лекция 3','Лекция 4','Лекция 5','Практическое занятие','Зачет','Зачет с оценкой'];
  $('#lessonActivityLabel').textContent=discipline==='Элективная физическая культура и спорт'?'Практическое занятие':'Занятие';
  $('#lessonTopic').innerHTML='<option value="">Выберите '+(discipline==='Элективная физическая культура и спорт'?'тему':'занятие')+'</option>'+types.map(value=>`<option>${escapeHtml(value)}</option>`).join('');
  $('#activeDisciplineLabel').textContent=discipline;
  $('#attendanceSubtitle').innerHTML=`Группа <span data-group-label>${escapeHtml(window.groupDisplayName?.(activeGroup) || activeGroup)}</span> · ${escapeHtml(discipline)}`;
  $('#attendanceSetup').hidden=true;
  $('#attendanceJournal').hidden=false;
  $('#saveAttendance').hidden=false;
  $('#lessonTopic').value='';
  activeLessonType='';
  $('#saveAttendance').disabled=true;
  $('#attendanceGradeHeading').hidden=true;
  await load().catch(()=>toast('Не удалось загрузить журнал за выбранную дату.'));
  toast('Журнал открыт для отметки посещаемости.');
};
$('#changeDiscipline').onclick=resetAttendanceFlow;
$('#lessonTopic').addEventListener('change',async()=>{activeLessonType=$('#lessonTopic').value;$('#saveAttendance').disabled=!activeLessonType;const graded=activeLessonType==='Зачет с оценкой';$('#attendanceGradeHeading').hidden=!graded;$('#attendanceStatusHeading').hidden=graded;if(graded)students.forEach(student=>student.present=true);await load().catch(error=>toast(error.message));});
$('#lessonDate').addEventListener('change',()=>load().catch(()=>toast('Не удалось загрузить журнал за выбранную дату.')));
$('#saveAttendance').onclick=async()=>{
  if(!activeDiscipline)return toast('Сначала выберите дисциплину.');
  if(!activeLessonType)return toast('Сначала выберите занятие.');
  if(activeLessonType==='Зачет с оценкой'&&students.some(student=>!student.grade))return toast('Выберите оценку для каждого студента.');
  try { await api('/api/attendance','POST',{lesson_date:$('#lessonDate').value,discipline:activeDiscipline,lesson_type:activeLessonType,items:students.map(student=>({id:student.id,present:!!student.present,grade:student.grade||''}))}); await load(); toast('Отметки и результаты сохранены.'); }
  catch(error) { toast(error.message); }
};
$('#physicalDate').value=todayLocal();
$('#lessonDate').value=todayLocal();
$('#savePhysical').onclick=async()=>{
  const exercise=$('#physicalExercise').value.trim(),result=$('#physicalResult').value.trim(),studentId=Number($('#physicalStudent').value),test_category=$('#physicalCategory').value;
  if(!studentId||!test_category||!exercise||!result)return toast('Выберите студента, группу испытания и укажите упражнение с результатом.');
  try { await api('/api/physical-tests','POST',{student_id:studentId,record_date:$('#physicalDate').value,test_category,exercise,result}); $('#physicalCategory').value=''; $('#physicalExercise').value=''; $('#physicalResult').value=''; await load(); toast('Результат физической подготовленности сохранен.'); }
  catch(error) { toast(error.message); }
};
document.querySelectorAll('.submission-field').forEach(field=>field.hidden=true);
$('#submissionCategory').addEventListener('change',event=>{const key=categoryKey(event.target.value);filterAchievementChoices(key,$('#submissionDistinction'));document.querySelectorAll('.submission-field').forEach(field=>field.hidden=!field.dataset.for.split(/\s+/).includes(key));$('#submissionEventStatus').required=key==='event';});
$('#submitStudentData').onclick=async()=>{
  const category=$('#submissionCategory').value;
  if(category&&!studentData?.registered)return toast('Сначала дождитесь подтверждения профиля; достижение можно подать вместе с первичной регистрацией.');
  const data=category?{category,sport_type:$('#submissionSport').value,distinction:$('#submissionDistinction').value,age_group:$('#submissionAgeGroup').value,birth_date:studentData?.student?.birth_date,team_name:$('#submissionTeam').value,section:$('#submissionSection').value,event_name:$('#submissionEvent').value,event_status:$('#submissionEventStatus').value,participant_role:$('#submissionRole').value,event_result:$('#submissionResult').value,record_date:$('#submissionDate').value,order_basis:$('#submissionOrder').value}:{name:$('#submissionName').value.trim(),birth_date:$('#submissionBirth').value,faculty:$('#submissionFaculty').value.trim(),course:Number($('#submissionCourse').value),group_code:$('#submissionGroup').value,health:$('#submissionHealth').value,sport_before:$('#submissionSportBefore').value.trim(),elective:$('#submissionElective').value.trim(),personal_data_consent:$('#submissionConsent').checked};
  if (!category) {
    if (data.name.split(/\s+/).length < 2 || !data.birth_date || !data.faculty || !data.course || !data.group_code) {
      go('studentPortal','0','submissionName');
      return toast('Заполните ФИО, дату рождения, факультет, курс и группу.');
    }
    if (!data.personal_data_consent) {
      go('studentPortal','0','submissionConsent');
      return toast('Подтвердите согласие на обработку данных.');
    }
    data.elective_semester = $('#submissionSemester').value;
    data.prior_rank = $('#submissionPriorRank').value;
    data.prior_gto = $('#submissionPriorGto').value;
    const returned = studentData?.draft || studentData?.submission;
    if (returned?.status === 'Отклонено' && returned.has_health_document) data.reuse_health_document_from = returned.id;
    if (Boolean(data.elective) !== Boolean(data.elective_semester)) {
      go('studentPortal','0','submissionElective');
      return toast('Укажите элективную дисциплину и её семестр.');
    }
  }
  const file=$(category?'#submissionDocument':'#submissionHealthDocument').files[0];
  if(file){if(file.type!=='application/pdf'||file.size>3*1024*1024)return toast('Приложите PDF до 3 МБ.');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Не удалось прочитать PDF.'));reader.readAsDataURL(file);});const prefix=category?'':'health_';data[prefix+'document_name']=file.name;data[prefix+'document_base64']=String(dataUrl).split(',')[1]||'';}
  try{await api('/api/student-submissions','POST',data);$('#submissionCategory').value='';$('#submissionDocument').value='';$('#submissionHealthDocument').value='';document.querySelectorAll('.submission-field').forEach(field=>field.hidden=true);await loadStudentPortal();toast('Данные отправлены ответственному на проверку.');}catch(error){toast(error.message);}
};
function openAchievementForm(kind) {
  ['achievementSport','achievementDistinction','achievementAgeGroup','achievementTeam','achievementSection','achievementEvent','achievementResult','achievementEventStatus','achievementOrder','achievementNote'].forEach(id=>$('#'+id).value='');
  $('#achievementStatus').value='Действующий';
  $('#achievementRole').value='Участник';
  $('#achievementStudent').selectedIndex=0;
  $('#achievementStudent').innerHTML=students.map(student=>`<option value="${student.id}">${escapeHtml(student.name)}</option>`).join('');
  $('#achievementDate').value=todayLocal();
  $('#achievementDocument').value='';
  const category = [...$('#achievementCategory').options].find(option=>categoryKey(option.value)===kind)?.value;
  $('#achievementCategory').value=category || 'Спортивное звание (разряд)';
  const selected=$('#achievementStudent').selectedOptions[0];$('#achievementAgeGroup').value=gtoStageFromBirth(selected?.dataset.birth,$('#achievementDate').value)||'';
  fillCategoryFields('', $('#achievementCategory').value);
  $('#achievementModal').hidden=false;
}
$('#openAchievement').onclick=()=>openAchievementForm($('.achievement-tabs .active')?.dataset.achievementFilter);
$('#achievementCategory').onchange=event=>{fillCategoryFields('',event.target.value);if(categoryKey(event.target.value)==='gto'){const selected=$('#achievementStudent').selectedOptions[0];$('#achievementAgeGroup').value=gtoStageFromBirth(selected?.dataset.birth,$('#achievementDate').value)||'';}};
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
$('#exportReport').onclick=()=>{window.location.href='/api/consolidated.xlsx';toast('Сводная ведомость подготовлена.')};
$('#exportGroupRoster').onclick=()=>{window.location.href=`/api/export.xlsx?group=${encodeURIComponent(activeGroup)}`;toast('Ведомость группы подготовлена.')};
$('#saveGroupOrganizer').onclick=async()=>{try{await api('/api/group-organizer','PUT',{group_code:activeGroup,sports_organizer:$('#groupOrganizerName').value.trim()});toast('Спортивный организатор группы сохранен.')}catch(error){toast(error.message)}};
  $('#guideStart').onclick=()=>{tour=tourByRole[selectedRole]||defaultTour;step=0;updateTour();};
$('#tourNext').onclick=()=>{step===tour.length-1?closeGuide():(step++,updateTour());};
$('#tourSkip').onclick=$('#closeTour').onclick=closeGuide;
addEventListener('change',event=>{
  const grade=event.target.closest('[data-grade-student]');
  if(grade){const student=students.find(item=>item.id===Number(grade.dataset.gradeStudent));if(student)student.grade=grade.value;}
});
addEventListener('resize',()=>!$('#tourMask').hidden&&placeTourSpotlight());
for (const id of ['saveAchievement','saveAchievementEdit','saveStudent','saveStudentEdit','savePhysical','saveAttendance','submitStudentData','saveGroupOrganizer']) {
  const button = $('#'+id), action = button.onclick;
  button.onclick = event => runFormAction(button, () => action(event)).catch(error => toast(error.message));
}
$('.brand').onclick = event => { event.preventDefault(); go('roleHome'); };
$('#retryWorkspace').onclick = () => location.reload();
initializeApp().catch(error=>{
  $('#workspaceLoading').textContent = error.message || 'Не удалось загрузить рабочее место.';
  $('#workspaceRecovery').hidden = false;
});
