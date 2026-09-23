-- Synthetic-only test records. Never replace these with student exports
-- until the university approves cloud processing and the host region.
INSERT INTO public.academic_groups(group_code,source,display_code,faculty,direction,course) VALUES
('0901','demo','12509-01','Факультет цифровых промышленных технологий','09.03.01 Информатика и вычислительная техника',1),
('0902','demo','12509-02','Факультет цифровых промышленных технологий','09.03.01 Информатика и вычислительная техника',1),
('0903','demo','12509-03','Факультет цифровых промышленных технологий','09.03.01 Информатика и вычислительная техника',1),
('0904','demo','12509-04','Факультет цифровых промышленных технологий','09.03.01 Информатика и вычислительная техника',1),
('0905','demo','12509-05','Факультет цифровых промышленных технологий','09.03.01 Информатика и вычислительная техника',1),
('0906','demo','12509-06','Факультет цифровых промышленных технологий','09.03.01 Информатика и вычислительная техника',1),
('0907','demo','12509-07','Факультет цифровых промышленных технологий','09.03.01 Информатика и вычислительная техника',1),
('0908','demo','12509-08','Факультет цифровых промышленных технологий','09.03.01 Информатика и вычислительная техника',1),
('1001','demo','12510-01','Факультет цифровых промышленных технологий','10.03.01 Информационная безопасность',1),
('1501','demo','12515-01','Факультет цифровых промышленных технологий','15.03.01 Машиностроение',1),
('1502','demo','12515-02','Факультет цифровых промышленных технологий','15.03.01 Машиностроение',1),
('1503','demo','12515-03','Факультет цифровых промышленных технологий','15.03.01 Машиностроение',1),
('1507','demo','12515-07','Факультет цифровых промышленных технологий','15.03.06 Мехатроника и робототехника',1),
('2634','demo','12526-34','Факультет цифровых промышленных технологий','26.05.01 Проектирование и постройка кораблей, судов и объектов океанотехники',1)
ON CONFLICT(group_code) DO NOTHING;

INSERT INTO public.students(name,health,attendance,theory,practice,group_code,list_position)
SELECT 'Демо-студент ' || lpad(n::text,2,'0'),
       CASE WHEN n % 7 = 0 THEN 'подготовительная' WHEN n % 13 = 0 THEN 'специальная' ELSE 'основная' END,
       CASE WHEN n % 4 = 0 THEN 72 ELSE 88 END,
       CASE WHEN n % 5 = 0 THEN 'не зачет' ELSE 'зачет' END,
       CASE WHEN n % 6 = 0 THEN 'не зачет' ELSE 'зачет' END,
       g.group_code,
       n
FROM public.academic_groups g CROSS JOIN generate_series(1,28) AS n
WHERE g.source='demo'
  AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.group_code=g.group_code);

INSERT INTO public.attendance_log(student_id,lesson_date,topic,present)
SELECT s.id, DATE '2026-09-16', 'Общая физическая подготовка', s.list_position % 4 <> 0
FROM public.students s
WHERE s.group_code='0905' AND s.list_position IS NOT NULL
ON CONFLICT(student_id,lesson_date) DO NOTHING;

INSERT INTO public.achievements(student_id,category,details,record_date,status,distinction,participant_role)
SELECT s.id,'ВФСК «ГТО»','Демонстрационная запись для проверки интерфейса','16.09.2026','Подтверждено','Золотой знак','Участник'
FROM public.students s WHERE s.group_code='0905' AND s.list_position=1
AND NOT EXISTS (SELECT 1 FROM public.achievements a WHERE a.student_id=s.id AND a.details='Демонстрационная запись для проверки интерфейса');

INSERT INTO public.physical_tests(student_id,record_date,exercise,result)
SELECT s.id, DATE '2026-09-16', 'Бег 100 м', '14,2 с'
FROM public.students s WHERE s.group_code='0905' AND s.list_position=1
ON CONFLICT(student_id,record_date,exercise) DO NOTHING;
