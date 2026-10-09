import json
import sqlite3
import base64
import os
import hmac
import hashlib
import time
import re
import smtplib
from email.message import EmailMessage
from contextvars import ContextVar
from functools import wraps
from datetime import date
from io import BytesIO
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.parse import quote
from http.cookies import SimpleCookie
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent
DB = ROOT / "fkis.db"
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
APP_ENV = os.environ.get("APP_ENV", "development")

try:
    import psycopg
except ImportError:
    psycopg = None

if DATABASE_URL and psycopg is None:
    raise RuntimeError("Установите зависимости из requirements.txt для подключения к PostgreSQL.")

DB_ERRORS = (sqlite3.Error,) + ((psycopg.Error,) if psycopg else ())
_REQUEST_CONNECTION = ContextVar("request_connection", default=None)
APP_USERNAME = os.environ.get("APP_USERNAME", "fizruk")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
SESSION_SECRET = os.environ.get("SESSION_SECRET", "local-development-only")
AUTH_ENABLED = bool(APP_PASSWORD)
ROLE_ACCOUNTS = {
    "Преподаватель кафедры ФВ": (APP_USERNAME, APP_PASSWORD),
    "Сотрудник ССК «Армада»": (os.environ.get("ARMADA_USERNAME", ""), os.environ.get("ARMADA_PASSWORD", "")),
    "Ответственный исполнитель кафедры ФВ": (os.environ.get("EXECUTOR_USERNAME", ""), os.environ.get("EXECUTOR_PASSWORD", "")),
}
ROLES = ("Преподаватель кафедры ФВ", "Сотрудник ССК «Армада»", "Студент", "Ответственный исполнитель кафедры ФВ")
FITNESS_DISCIPLINES = ("Физическая культура и спорт", "Элективная физическая культура и спорт")
FITNESS_ACTIVITIES = ("Общая физическая подготовка", "Плавание", "Единоборства", "Фитнес (акробатика и т.п.)", "Зачет")
LESSON_TYPES = ("Лекция 1", "Лекция 2", "Лекция 3", "Лекция 4", "Лекция 5", "Практическое занятие", "Зачет", "Зачет с оценкой")
ACHIEVEMENT_CATEGORIES = ["Спортивное звание (разряд)", "ВФСК «ГТО»", "Сборная команда", "Спортивная секция", "Спортивное мероприятие"]
PHYSICAL_CATEGORIES = ("Сила", "Быстрота", "Выносливость", "Гибкость", "Прикладной навык")
if APP_ENV == "production" and (not DATABASE_URL or not APP_PASSWORD or not os.environ.get("SESSION_SECRET")):
    raise RuntimeError("Для production задайте DATABASE_URL, APP_PASSWORD и SESSION_SECRET.")


class HybridRow(dict):
    """Psycopg row that preserves sqlite3.Row-style name and numeric access."""
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def postgres_row_factory(cursor):
    columns = [column.name for column in (cursor.description or [])]
    return lambda values: HybridRow(zip(columns, values))


class PostgresConnection:
    def __init__(self, connection):
        self.connection = connection

    def execute(self, sql, args=()):
        sql = sql.replace("?", "%s")
        converted = tuple(
            date.fromisoformat(value) if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value) else value
            for value in args
        )
        return self.connection.execute(sql, converted)

    def commit(self): self.connection.commit()
    def rollback(self): self.connection.rollback()
    def close(self): self.connection.close()

DEFAULT_GROUP = "0905"

POSTGRES_BOOTSTRAP_QUERY = """
WITH params AS (SELECT ?::text AS group_code, ?::date AS lesson_date, ?::text AS discipline, ?::text AS lesson_type),
selected_students AS (
  SELECT s.id,s.name,s.health,s.attendance,s.theory,s.practice,s.group_code,s.isu_id,
    s.enrollment_number,s.study_form,s.list_position,s.birth_date,s.theory_date,s.sport_before,s.elective,
    CASE WHEN COUNT(a.id)>0
    THEN ROUND(100.0*SUM(CASE WHEN a.present THEN 1 ELSE 0 END)/COUNT(a.id))
    ELSE s.attendance END AS computed_attendance,
    COUNT(a.id) AS attendance_records_count,
    COALESCE(SUM(CASE WHEN a.present THEN 1 ELSE 0 END),0) AS attendance_present_count
  FROM students s CROSS JOIN params p
  LEFT JOIN attendance_log a ON a.student_id=s.id
  WHERE s.group_code=p.group_code
  GROUP BY s.id
),
health_summary AS (
  SELECT s.health AS label,COUNT(*) AS count FROM students s CROSS JOIN params p
  WHERE s.group_code=p.group_code GROUP BY s.health
),
theory_summary AS (
  SELECT s.theory AS label,COUNT(*) AS count FROM students s CROSS JOIN params p
  WHERE s.group_code=p.group_code GROUP BY s.theory
),
practice_summary AS (
  SELECT s.practice AS label,COUNT(*) AS count FROM students s CROSS JOIN params p
  WHERE s.group_code=p.group_code GROUP BY s.practice
),
achievement_summary AS (
  SELECT a.category AS label,COUNT(*) AS count
  FROM achievements a JOIN students s ON s.id=a.student_id CROSS JOIN params p
  WHERE s.group_code=p.group_code GROUP BY a.category
)
SELECT json_build_object(
  'sports_organizer', (SELECT g.sports_organizer FROM academic_groups g CROSS JOIN params p WHERE g.group_code=p.group_code),
  'students', COALESCE((SELECT json_agg(to_jsonb(s) ORDER BY COALESCE(s.list_position,2147483647),s.name) FROM selected_students s),'[]'::json),
  'achievements', COALESCE((SELECT json_agg(json_build_object(
    'id',a.id,'student_id',a.student_id,'name',s.name,'category',a.category,
    'details',a.details,'record_date',a.record_date,'status',a.status,
    'sport_type',a.sport_type,'distinction',a.distinction,'age_group',a.age_group,
    'order_basis',a.order_basis,'participant_role',a.participant_role,
    'event_result',a.event_result,'event_status',a.event_status,'note',a.note,'document_name',a.document_name,'team_name',a.team_name
  ) ORDER BY a.id DESC) FROM achievements a JOIN students s ON s.id=a.student_id CROSS JOIN params p WHERE s.group_code=p.group_code),'[]'::json),
  'physical_tests', COALESCE((SELECT json_agg(json_build_object(
    'id',t.id,'student_id',t.student_id,'record_date',t.record_date,
    'exercise',t.exercise,'test_category',t.test_category,'result',t.result,'grade',t.grade,'name',s.name
  ) ORDER BY t.record_date DESC,t.id DESC) FROM physical_tests t JOIN students s ON s.id=t.student_id CROSS JOIN params p WHERE s.group_code=p.group_code),'[]'::json),
  'attendance_records', COALESCE((SELECT json_agg(json_build_object(
    'student_id',a.student_id,'present',a.present,'topic',a.topic,'discipline',a.discipline,'lesson_type',a.lesson_type,'grade',a.grade
  )) FROM attendance_log a CROSS JOIN params p WHERE a.lesson_date=p.lesson_date AND a.discipline=p.discipline AND a.lesson_type=p.lesson_type AND a.student_id IN (SELECT id FROM students WHERE group_code=p.group_code)),'[]'::json),
  'attendance_trend', COALESCE((SELECT json_agg(json_build_object(
    'lesson_date',t.lesson_date,'total',t.total,'present',t.present
  ) ORDER BY t.lesson_date DESC) FROM (
    SELECT a.lesson_date,COUNT(*) AS total,SUM(CASE WHEN a.present THEN 1 ELSE 0 END) AS present
    FROM attendance_log a WHERE a.student_id IN (SELECT s.id FROM students s CROSS JOIN params p WHERE s.group_code=p.group_code)
    GROUP BY a.lesson_date ORDER BY a.lesson_date DESC LIMIT 7
  ) t),'[]'::json),
  'summary', json_build_object(
    'health', COALESCE((SELECT json_agg(json_build_object('label',label,'count',count) ORDER BY label) FROM health_summary),'[]'::json),
    'theory', COALESCE((SELECT json_agg(json_build_object('label',label,'count',count) ORDER BY label) FROM theory_summary),'[]'::json),
    'practice', COALESCE((SELECT json_agg(json_build_object('label',label,'count',count) ORDER BY label) FROM practice_summary),'[]'::json),
    'achievements', COALESCE((SELECT json_agg(json_build_object('label',label,'count',count) ORDER BY label) FROM achievement_summary),'[]'::json),
    'attendance', (SELECT json_build_object('lessons',COUNT(*),'present',COALESCE(SUM(CASE WHEN a.present THEN 1 ELSE 0 END),0)) FROM attendance_log a WHERE a.student_id IN (SELECT s.id FROM students s CROSS JOIN params p WHERE s.group_code=p.group_code))
  )
) AS data
"""

def _new_connection():
    if DATABASE_URL:
        return PostgresConnection(psycopg.connect(DATABASE_URL, row_factory=postgres_row_factory, connect_timeout=10))
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con

def connect():
    return _REQUEST_CONNECTION.get() or _new_connection()

def share_read_connection(handler):
    @wraps(handler)
    def wrapped(self, *args, **kwargs):
        path = urlparse(self.path).path
        if not DATABASE_URL or path not in ("/api/groups", "/api/bootstrap", "/api/export.xlsx", "/api/consolidated", "/api/consolidated.xlsx"):
            return handler(self, *args, **kwargs)
        connection = _new_connection()
        token = _REQUEST_CONNECTION.set(connection)
        try:
            return handler(self, *args, **kwargs)
        finally:
            _REQUEST_CONNECTION.reset(token)
            connection.close()
    return wrapped

def init_db():
    if DATABASE_URL:
        con = connect()
        try:
            required = ("academic_groups", "students", "attendance_log", "achievements", "physical_tests")
            missing = [name for name in required if not con.execute("SELECT to_regclass(?) AS table_name", (f"public.{name}",)).fetchone()["table_name"]]
            if missing:
                raise RuntimeError("В удалённой базе отсутствуют таблицы: " + ", ".join(missing) + ". Выполните SQL из supabase/schema.sql.")
            con.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS email text")
            con.execute("ALTER TABLE academic_groups ADD COLUMN IF NOT EXISTS sports_organizer text")
            con.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS faculty text")
            con.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS course integer")
            con.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS sport_before text")
            con.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS elective text")
            con.execute("ALTER TABLE students ADD COLUMN IF NOT EXISTS personal_data_consent boolean NOT NULL DEFAULT false")
            con.execute("ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS discipline text NOT NULL DEFAULT 'Физическая культура и спорт'")
            con.execute("ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS lesson_type text NOT NULL DEFAULT 'Практическое занятие'")
            con.execute("ALTER TABLE attendance_log ADD COLUMN IF NOT EXISTS grade text")
            con.execute("ALTER TABLE physical_tests ADD COLUMN IF NOT EXISTS grade text")
            con.execute("ALTER TABLE physical_tests ADD COLUMN IF NOT EXISTS test_category text")
            con.execute("ALTER TABLE achievements ADD COLUMN IF NOT EXISTS event_status text")
            con.execute("ALTER TABLE attendance_log DROP CONSTRAINT IF EXISTS attendance_student_lesson_unique")
            con.execute("CREATE UNIQUE INDEX IF NOT EXISTS attendance_student_lesson_unique ON attendance_log(student_id,lesson_date,discipline,lesson_type)")
            con.execute("CREATE TABLE IF NOT EXISTS student_accounts(email text PRIMARY KEY,password_salt text NOT NULL,password_hash text NOT NULL,student_id bigint REFERENCES students(id),created_at timestamptz NOT NULL DEFAULT now())")
            con.execute("CREATE TABLE IF NOT EXISTS student_submissions(id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,email text NOT NULL REFERENCES student_accounts(email),payload text NOT NULL,status text NOT NULL DEFAULT 'На проверке',review_note text,created_at timestamptz NOT NULL DEFAULT now(),reviewed_at timestamptz)")
            con.execute("CREATE INDEX IF NOT EXISTS idx_student_submissions_status ON student_submissions(status,created_at)")
            con.commit()
        finally:
            con.close()
        return
    con = connect()
    con.executescript("""
      CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT NOT NULL, health TEXT NOT NULL, attendance INTEGER NOT NULL DEFAULT 0, theory TEXT NOT NULL DEFAULT 'не указано', practice TEXT NOT NULL DEFAULT 'не указано', group_code TEXT NOT NULL DEFAULT '0905');
      CREATE TABLE IF NOT EXISTS attendance_log (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), lesson_date TEXT NOT NULL, topic TEXT NOT NULL, discipline TEXT NOT NULL DEFAULT 'Физическая культура и спорт', lesson_type TEXT NOT NULL DEFAULT 'Практическое занятие', grade TEXT, present INTEGER NOT NULL, UNIQUE(student_id, lesson_date, discipline, lesson_type));
      CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), category TEXT NOT NULL, details TEXT NOT NULL, record_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Подтверждено');
      CREATE TABLE IF NOT EXISTS physical_tests (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), record_date TEXT NOT NULL, exercise TEXT NOT NULL, result TEXT NOT NULL, UNIQUE(student_id,record_date,exercise));
      CREATE TABLE IF NOT EXISTS academic_groups (group_code TEXT PRIMARY KEY, source TEXT NOT NULL DEFAULT 'local');
      CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_log(student_id, lesson_date);
      CREATE INDEX IF NOT EXISTS idx_achievements_student ON achievements(student_id);
    """)
    group_columns = [r[1] for r in con.execute("PRAGMA table_info(academic_groups)")]
    for name, declaration in {
        "display_code": "TEXT", "faculty": "TEXT", "direction": "TEXT", "course": "INTEGER", "sports_organizer": "TEXT"
    }.items():
        if name not in group_columns:
            con.execute(f"ALTER TABLE academic_groups ADD COLUMN {name} {declaration}")
    columns = [r[1] for r in con.execute("PRAGMA table_info(students)")]
    if "group_code" not in columns:
        con.execute("ALTER TABLE students ADD COLUMN group_code TEXT NOT NULL DEFAULT '12509-05'")
    for name, declaration in {
        "isu_id": "TEXT", "enrollment_number": "TEXT", "study_form": "TEXT",
        "list_position": "INTEGER", "birth_date": "TEXT", "theory_date": "TEXT",
        "email": "TEXT", "faculty": "TEXT", "course": "INTEGER", "sport_before": "TEXT",
        "elective": "TEXT", "personal_data_consent": "INTEGER NOT NULL DEFAULT 0"
    }.items():
        if name not in columns:
            con.execute(f"ALTER TABLE students ADD COLUMN {name} {declaration}")
    achievement_columns = [r[1] for r in con.execute("PRAGMA table_info(achievements)")]
    for name, declaration in {
        "sport_type": "TEXT", "distinction": "TEXT", "age_group": "TEXT",
        "order_basis": "TEXT", "participant_role": "TEXT", "event_result": "TEXT",
        "event_status": "TEXT", "note": "TEXT", "document_name": "TEXT", "document_data": "BLOB",
        "team_name": "TEXT"
    }.items():
        if name not in achievement_columns:
            con.execute(f"ALTER TABLE achievements ADD COLUMN {name} {declaration}")
    physical_columns=[r[1] for r in con.execute("PRAGMA table_info(physical_tests)")]
    if "grade" not in physical_columns: con.execute("ALTER TABLE physical_tests ADD COLUMN grade TEXT")
    if "test_category" not in physical_columns: con.execute("ALTER TABLE physical_tests ADD COLUMN test_category TEXT")
    con.execute("CREATE INDEX IF NOT EXISTS idx_students_group ON students(group_code)")
    con.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_students_isu_id ON students(isu_id) WHERE isu_id IS NOT NULL")
    attendance_sql = con.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='attendance_log'").fetchone()[0]
    if "UNIQUE(student_id, lesson_date)" in attendance_sql.replace(" ", "") or "unique(student_id,lesson_date)" in attendance_sql.lower().replace(" ", ""):
        legacy = con.execute("SELECT id,student_id,lesson_date,topic,present FROM attendance_log").fetchall()
        con.execute("PRAGMA foreign_keys=OFF")
        con.execute("ALTER TABLE attendance_log RENAME TO attendance_log_legacy")
        con.execute("CREATE TABLE attendance_log (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), lesson_date TEXT NOT NULL, topic TEXT NOT NULL, discipline TEXT NOT NULL DEFAULT 'Физическая культура и спорт', lesson_type TEXT NOT NULL DEFAULT 'Практическое занятие', grade TEXT, present INTEGER NOT NULL, UNIQUE(student_id, lesson_date, discipline, lesson_type))")
        for row in legacy:
            topic = str(row[3] or "Практическое занятие")
            prefix, _, suffix = topic.partition(" · ")
            discipline = "Элективная физическая культура и спорт" if prefix.strip().lower() in ("практика фкис", "элективная физическая культура и спорт") else "Физическая культура и спорт"
            activity = suffix.strip() or topic
            con.execute("INSERT INTO attendance_log(id,student_id,lesson_date,topic,discipline,lesson_type,present) VALUES(?,?,?,?,?,?,?)", (row[0],row[1],row[2],activity,discipline,activity,row[4]))
        con.execute("DROP TABLE attendance_log_legacy")
        con.execute("CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_log(student_id,lesson_date)")
        con.execute("PRAGMA foreign_keys=ON")
    con.executescript("""
      CREATE TABLE IF NOT EXISTS student_accounts(email TEXT PRIMARY KEY,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,student_id INTEGER REFERENCES students(id),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS student_submissions(id INTEGER PRIMARY KEY, email TEXT NOT NULL REFERENCES student_accounts(email), payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'На проверке', review_note TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, reviewed_at TEXT);
      CREATE INDEX IF NOT EXISTS idx_student_submissions_status ON student_submissions(status,created_at);
    """)
    con.commit(); con.close()

def rows(sql, args=()):
    shared = _REQUEST_CONNECTION.get()
    con = shared or _new_connection()
    try:
        return [dict(r) for r in con.execute(sql,args).fetchall()]
    finally:
        if shared is None:
            con.close()

def empty_consolidated_row(label, level):
    return {"level":level,"label":label,"total":0,"main_health":0,"prep_health":0,"special_health":0,
        "theory_credit":0,"theory_no_credit":0,"practice_credit":0,"practice_no_credit":0,"overall_grade":None,
        "teams":0,"gto_gold":0,"gto_silver":0,"gto_bronze":0,"gto_none":0,"ms":0,"kms":0,
        "rank1":0,"rank2":0,"rank3":0,"rank_none":0,"sport_achievements":0,"participants":0,"volunteers":0}

def build_consolidated_rows(students, achievements):
    faculties={}; courses={}; all_students=empty_consolidated_row("СПбГМТУ","total")
    def add_student(bucket, student):
        bucket["total"]+=1
        health={"основная":"main_health","подготовительная":"prep_health","специальная":"special_health"}.get(str(student.get("health") or "").lower())
        if health: bucket[health]+=1
        for source,target in (("theory","theory"),("practice","practice")):
            value=str(student.get(source) or "").lower()
            if value=="зачет": bucket[target+"_credit"]+=1
            elif value=="не зачет": bucket[target+"_no_credit"]+=1
    by_student={}
    for student in students:
        faculty=str(student.get("faculty") or "Подразделение не указано")
        course=student.get("course")
        course_label=f"{course} курс" if course else "Курс не указан"
        faculty_row=faculties.setdefault(faculty,empty_consolidated_row(faculty,"faculty"))
        course_row=courses.setdefault((faculty,course_label),empty_consolidated_row(course_label,"course"))
        by_student[student["id"]]=(faculty_row,course_row,all_students)
        add_student(faculty_row,student); add_student(course_row,student); add_student(all_students,student)
    gto_students=set(); rank_students=set()
    for award in achievements:
        targets=by_student.get(award.get("student_id"))
        if not targets: continue
        category=str(award.get("category") or "").lower()
        distinction=str(award.get("distinction") or "").lower()
        status=str(award.get("status") or "").lower()
        active=status not in ("исключен","не действует")
        for target in targets:
            if "гто" in category and active:
                gto_students.add(award["student_id"])
                if "золот" in distinction: target["gto_gold"]+=1
                elif "серебр" in distinction: target["gto_silver"]+=1
                elif "бронз" in distinction: target["gto_bronze"]+=1
            elif ("разряд" in category or "звание" in category) and active:
                rank_students.add(award["student_id"])
                if "кандидат" in distinction or "кмс" in distinction: target["kms"]+=1
                elif "мастер" in distinction or "мс" in distinction: target["ms"]+=1
                elif "перв" in distinction or distinction in ("1", "i" ) or "i разряд" in distinction: target["rank1"]+=1
                elif "втор" in distinction or distinction in ("2", "ii") or "ii разряд" in distinction: target["rank2"]+=1
                elif "трет" in distinction or distinction in ("3", "iii") or "iii разряд" in distinction: target["rank3"]+=1
            elif "сборная" in category and active: target["teams"]+=1
            if "мероприят" in category:
                if award.get("event_result"):
                    target["sport_achievements"]+=1
                if award.get("participant_role")=="Участник": target["participants"]+=1
                elif award.get("participant_role")=="Волонтер": target["volunteers"]+=1
    for student_id,targets in by_student.items():
        for target in targets:
            if student_id not in gto_students: target["gto_none"]+=1
            if student_id not in rank_students: target["rank_none"]+=1
    result=[]
    sort_course=lambda key:(not key[1][0].isdigit(),int(key[1].split()[0]) if key[1][0].isdigit() else 99)
    for faculty in sorted(faculties):
        result.extend(courses[key] for key in sorted((key for key in courses if key[0]==faculty),key=sort_course))
        result.append(faculties[faculty])
    if all_students["total"]: result.append({**all_students,"level":"total","label":"СПбГМТУ"})
    return result

def decode_pdf(value):
    if not value:
        return None
    document = base64.b64decode(value, validate=True)
    if len(document) > 10 * 1024 * 1024:
        raise ValueError("Файл не должен превышать 10 МБ.")
    if not document.startswith(b"%PDF-"):
        raise ValueError("Подтверждающий документ должен быть файлом PDF.")
    return document

def password_digest(password, salt=None):
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 310_000).hex()
    return salt, digest

def notify_student(email, subject, text):
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host or not os.environ.get("SMTP_FROM", "").strip():
        return False
    message = EmailMessage()
    message["From"] = os.environ["SMTP_FROM"]
    message["To"] = email
    message["Subject"] = subject
    message.set_content(text)
    try:
        with smtplib.SMTP(host, int(os.environ.get("SMTP_PORT", "587")), timeout=10) as smtp:
            smtp.starttls()
            if os.environ.get("SMTP_USERNAME"):
                smtp.login(os.environ["SMTP_USERNAME"], os.environ.get("SMTP_PASSWORD", ""))
            smtp.send_message(message)
        return True
    except (OSError, smtplib.SMTPException, ValueError) as error:
        print(f"Не удалось отправить уведомление студенту: {error}")
        return False

class App(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def send_json(self, value, status=200):
        raw=json.dumps(value,ensure_ascii=False,default=lambda item:item.isoformat() if hasattr(item,"isoformat") else str(item)).encode(); self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def body(self): return json.loads(self.rfile.read(int(self.headers.get("Content-Length",0))) or b"{}")
    def session_info(self):
        try:
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            token = cookies.get("fkis_session")
            if not token:
                return {"username": APP_USERNAME, "role": ROLES[0], "student_id": None} if not AUTH_ENABLED else None
            payload, signature = token.value.rsplit(".", 1)
            expected = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(signature, expected):
                return None
            decoded = base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)).decode()
            username, role, student_id, expiry = decoded.rsplit("|", 3)
            if int(expiry) <= int(time.time()) or role not in ROLES:
                return None
            if AUTH_ENABLED and role != "Студент" and ROLE_ACCOUNTS.get(role, (None,))[0] != username:
                return None
            if role == "Студент":
                account = rows("SELECT student_id FROM student_accounts WHERE email=?", (username,))
                if not account:
                    return None
                student_id = account[0]["student_id"]
            return {"username": username, "role": role, "student_id": int(student_id) if student_id else None}
        except (ValueError, TypeError, UnicodeDecodeError):
            return None
    def authenticated(self): return not AUTH_ENABLED or self.session_info() is not None
    def auth_required(self):
        if not AUTH_ENABLED or self.authenticated():
            return False
        self.send_json({"error":"Требуется войти в систему."},401)
        return True
    def role_required(self, *roles):
        if not AUTH_ENABLED:
            session = self.session_info()
        else:
            session = self.session_info()
        if session and session["role"] in roles:
            return False
        self.send_json({"error":"Недостаточно прав для этого действия."},403)
        return True
    def issue_session(self, username=APP_USERNAME, role=ROLES[0], student_id=None):
        payload = base64.urlsafe_b64encode(f"{username}|{role}|{student_id or ''}|{int(time.time()) + 43200}".encode()).decode().rstrip("=")
        signature = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
        return payload + "." + signature
    def set_session_cookie(self, username, role, student_id=None):
        token = self.issue_session(username, role, student_id)
        secure = self.headers.get("X-Forwarded-Proto", "").lower() == "https" or bool(os.environ.get("RENDER"))
        self.send_header("Set-Cookie", f"fkis_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200" + ("; Secure" if secure else ""))
    @share_read_connection
    def do_GET(self):
        path=urlparse(self.path).path
        query=parse_qs(urlparse(self.path).query)
        if path == "/health":
            self.send_json({"status":"ok"}); return
        if path == "/api/registration-groups":
            self.send_json({"groups":rows("SELECT group_code,COALESCE(display_code,group_code) AS display_code,faculty,direction,course FROM academic_groups ORDER BY faculty,direction,course,display_code")}); return
        if path == "/api/session":
            session = self.session_info()
            self.send_json({"auth_enabled":AUTH_ENABLED,"authenticated":self.authenticated(),"role":session["role"] if session else None,"username":session["username"] if session else None,"student_id":session["student_id"] if session else None}); return
        if path == "/login":
            self.path = "/login.html"
            return super().do_GET()
        if AUTH_ENABLED and not self.authenticated():
            public_assets = {"/styles.css", "/app.js", "/group-picker.js", "/achievement-filters.js", "/favicon.svg", "/smtu-logo.svg"}
            if path in public_assets:
                return super().do_GET()
            if path in ("/", "/index.html"):
                self.send_response(303); self.send_header("Location","/login"); self.end_headers(); return
            if path.startswith("/api/"):
                self.auth_required(); return
            self.send_json({"error":"Требуется войти в систему."},401); return
        if path == "/api/student-data":
            if self.role_required("Студент"): return
            session = self.session_info()
            if not session["student_id"]:
                pending = rows("SELECT id,payload,status,review_note,created_at FROM student_submissions WHERE email=? ORDER BY id DESC LIMIT 1",(session["username"],))
                if pending:
                    try: pending[0]["payload"]=json.loads(pending[0]["payload"])
                    except (ValueError,TypeError): pending[0]["payload"]={}
                    pending[0]["payload"].pop("document_base64",None)
                self.send_json({"registered":False,"submission":pending[0] if pending else None}); return
            student_id = session["student_id"]
            student = rows("SELECT s.id,s.name,s.health,s.attendance,s.theory,s.practice,s.group_code,s.isu_id,s.enrollment_number,s.study_form,s.list_position,s.birth_date,s.theory_date,s.faculty,s.course,s.sport_before,s.elective,g.display_code FROM students s LEFT JOIN academic_groups g ON g.group_code=s.group_code WHERE s.id=?",(student_id,))
            if not student: self.send_json({"error":"Карточка студента не найдена."},404); return
            achievements = rows("SELECT category,details,record_date,status,sport_type,distinction,age_group,participant_role,event_result,event_status,team_name FROM achievements WHERE student_id=? ORDER BY id DESC",(student_id,))
            physical = rows("SELECT record_date,exercise,test_category,result,grade FROM physical_tests WHERE student_id=? ORDER BY record_date DESC",(student_id,))
            attendance=rows("SELECT COUNT(*) AS total,SUM(CASE WHEN present THEN 1 ELSE 0 END) AS present FROM attendance_log WHERE student_id=?",(student_id,))[0]
            self.send_json({"registered":True,"student":student[0],"achievements":achievements,"physical_tests":physical,"attendance":attendance}); return
        if path == "/api/my-submissions":
            if self.role_required("Студент"): return
            session=self.session_info()
            self.send_json({"submissions":rows("SELECT id,status,review_note,created_at,reviewed_at FROM student_submissions WHERE email=? ORDER BY id DESC",(session["username"],))}); return
        if path == "/api/pending-submissions":
            if self.role_required("Ответственный исполнитель кафедры ФВ"): return
            data=[]
            for item in rows("SELECT id,email,payload,status,created_at FROM student_submissions WHERE status='На проверке' ORDER BY created_at,id"):
                try: item["payload"]=json.loads(item["payload"])
                except (ValueError,TypeError): item["payload"]={}
                item["has_document"] = bool(item["payload"].pop("document_base64", None))
                data.append(item)
            self.send_json({"submissions":data}); return
        if path == "/api/attendance-options":
            self.send_json({"disciplines":FITNESS_DISCIPLINES,"lesson_types":LESSON_TYPES,"elective_activities":FITNESS_ACTIVITIES}); return
        if path == "/api/consolidated":
            if self.role_required("Преподаватель кафедры ФВ","Сотрудник ССК «Армада»","Ответственный исполнитель кафедры ФВ"): return
            course_rows=rows("SELECT s.id,COALESCE(g.faculty,s.faculty) AS faculty,COALESCE(g.course,s.course) AS course,s.health,s.theory,s.practice FROM students s LEFT JOIN academic_groups g ON g.group_code=s.group_code")
            awards=rows("SELECT a.student_id,a.category,a.distinction,a.participant_role,a.status FROM achievements a")
            self.send_json({"rows":build_consolidated_rows(course_rows,awards)}); return
        if path == "/api/consolidated.xlsx":
            if self.role_required("Преподаватель кафедры ФВ","Сотрудник ССК «Армада»","Ответственный исполнитель кафедры ФВ"): return
            course_rows=rows("SELECT s.id,COALESCE(g.faculty,s.faculty) AS faculty,COALESCE(g.course,s.course) AS course,s.health,s.theory,s.practice FROM students s LEFT JOIN academic_groups g ON g.group_code=s.group_code")
            awards=rows("SELECT a.student_id,a.category,a.distinction,a.participant_role,a.event_result,a.status FROM achievements a")
            data=build_consolidated_rows(course_rows,awards)
            headers=["Подразделение / курс","Всего","Основная","Подготовительная","Специальная","ТиМ: зачет","ТиМ: не зачет","Практика: зачет","Практика: не зачет","Общая оценка","Сборная","ГТО: золото","ГТО: серебро","ГТО: бронза","ГТО: отсутствует","МС","КМС","I разряд","II разряд","III разряд","Разряд: отсутствует","Достижения с результатом","Участники","Волонтеры"]
            fields=["label","total","main_health","prep_health","special_health","theory_credit","theory_no_credit","practice_credit","practice_no_credit","overall_grade","teams","gto_gold","gto_silver","gto_bronze","gto_none","ms","kms","rank1","rank2","rank3","rank_none","sport_achievements","participants","volunteers"]
            wb=Workbook(); sheet=wb.active; sheet.title="Сводные данные"
            navy="455273"; blue="517CB3"; pale="EDF4FB"; line="D9E2F0"; white="FFFFFF"; thin=Side(style="thin",color=line)
            sheet.merge_cells(start_row=1,start_column=1,end_row=1,end_column=len(headers)); sheet.cell(1,1,"СПбГМТУ · Сводные данные ФКиС")
            sheet.cell(1,1).font=Font(name="Fira Sans",size=16,bold=True,color=white); sheet.cell(1,1).fill=PatternFill("solid",fgColor=navy); sheet.cell(1,1).alignment=Alignment(horizontal="center")
            sheet.merge_cells(start_row=2,start_column=1,end_row=2,end_column=len(headers)); sheet.cell(2,1,f"По загруженным группам · {date.today().strftime('%d.%m.%Y')} · без персональных данных")
            sheet.cell(2,1).font=Font(name="Fira Sans",size=11,bold=True,color=navy); sheet.cell(2,1).fill=PatternFill("solid",fgColor=pale); sheet.cell(2,1).alignment=Alignment(horizontal="center")
            for col,label in enumerate(headers,1):
                cell=sheet.cell(4,col,label); cell.font=Font(name="Fira Sans",bold=True,color=white); cell.fill=PatternFill("solid",fgColor=blue); cell.alignment=Alignment(horizontal="center",vertical="center",wrap_text=True); cell.border=Border(bottom=thin)
            for row_index,item in enumerate(data,5):
                values=[item.get(field) for field in fields]
                for col,value in enumerate(values,1):
                    cell=sheet.cell(row_index,col,"—" if value is None else value); cell.font=Font(name="Fira Sans",size=10,color=navy if item["level"]!="course" else "212529",bold=item["level"]!="course")
                    if isinstance(value,str): cell.data_type="s"
                    cell.alignment=Alignment(vertical="center",wrap_text=True,horizontal="left" if col==1 else "center"); cell.border=Border(bottom=thin)
                    if item["level"]=="faculty": cell.fill=PatternFill("solid",fgColor=pale)
                    elif item["level"]=="total": cell.fill=PatternFill("solid",fgColor=navy); cell.font=Font(name="Fira Sans",size=10,bold=True,color=white)
                sheet.row_dimensions[row_index].height=26
            sheet.sheet_view.showGridLines=False; sheet.freeze_panes="B5"; sheet.row_dimensions[4].height=42
            if data: sheet.auto_filter.ref=f"A4:{get_column_letter(len(headers))}{len(data)+4}"
            sheet.column_dimensions["A"].width=48
            for col in range(2,len(headers)+1): sheet.column_dimensions[get_column_letter(col)].width=17
            stream=BytesIO(); wb.save(stream); raw=stream.getvalue()
            self.send_response(200); self.send_header("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); self.send_header("Content-Disposition","attachment; filename=fkis-summary.xlsx"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw); return
        group_code=query.get("group", [DEFAULT_GROUP])[0]
        if path in ("/api/groups","/api/bootstrap","/api/export.xlsx") and self.role_required("Преподаватель кафедры ФВ","Сотрудник ССК «Армада»","Ответственный исполнитель кафедры ФВ"): return
        if path == "/api/groups":
            self.send_json({"groups": rows("SELECT g.group_code,COALESCE(g.display_code,g.group_code) AS display_code,g.faculty,g.direction,g.course,COUNT(s.id) AS students FROM academic_groups g LEFT JOIN students s ON s.group_code=g.group_code GROUP BY g.group_code ORDER BY g.faculty,g.direction,g.course,g.display_code")}); return
        if not rows("SELECT group_code FROM academic_groups WHERE group_code=?",(group_code,)):
            group_code = DEFAULT_GROUP if rows("SELECT group_code FROM academic_groups WHERE group_code=?",(DEFAULT_GROUP,)) else ((rows("SELECT group_code FROM academic_groups ORDER BY group_code LIMIT 1") or [{"group_code":DEFAULT_GROUP}])[0]["group_code"])
        if path=="/api/export.xlsx":
            students=rows("SELECT s.*,CASE WHEN COUNT(a.id)>0 THEN ROUND(100.0*SUM(CASE WHEN a.present THEN 1 ELSE 0 END)/COUNT(a.id)) ELSE s.attendance END AS attendance_pct FROM students s LEFT JOIN attendance_log a ON a.student_id=s.id WHERE s.group_code=? GROUP BY s.id ORDER BY COALESCE(s.list_position,2147483647),s.name", (group_code,))
            achievements=rows("SELECT a.*,s.name,s.isu_id FROM achievements a JOIN students s ON s.id=a.student_id WHERE s.group_code=? ORDER BY s.list_position,a.id", (group_code,))
            tests=rows("SELECT p.*,s.name,s.isu_id,s.list_position FROM physical_tests p JOIN students s ON s.id=p.student_id WHERE s.group_code=? ORDER BY s.list_position,p.record_date,p.id", (group_code,))
            group_meta=rows("SELECT sports_organizer FROM academic_groups WHERE group_code=?",(group_code,))
            sports_organizer=group_meta[0]["sports_organizer"] if group_meta else None
            wb=Workbook(); overview=wb.active; overview.title="Карточка группы"
            roster=wb.create_sheet("Сводная ведомость"); fitness=wb.create_sheet("Физподготовка"); sport=wb.create_sheet("Достижения"); attendance=wb.create_sheet("Посещаемость")
            navy="455273"; blue="517CB3"; pale="EDF4FB"; line="D9E2F0"; white="FFFFFF"; ink="212529"
            thin=Side(style="thin",color=line)
            def title(sheet,label,columns):
                sheet.merge_cells(start_row=1,start_column=1,end_row=1,end_column=columns)
                cell=sheet.cell(1,1,label); cell.font=Font(name="Fira Sans",size=16,bold=True,color=white); cell.fill=PatternFill("solid",fgColor=navy); cell.alignment=Alignment(horizontal="center",vertical="center")
                sheet.row_dimensions[1].height=32
                sheet.merge_cells(start_row=2,start_column=1,end_row=2,end_column=columns)
                cell=sheet.cell(2,1,f"Группа {group_code} · сформировано {date.today().strftime('%d.%m.%Y')}"); cell.font=Font(name="Fira Sans",size=11,bold=True,color=navy); cell.fill=PatternFill("solid",fgColor=pale); cell.alignment=Alignment(horizontal="center")
                sheet.row_dimensions[2].height=23
                sheet.sheet_view.showGridLines=False
            def table(sheet,headers,data,widths):
                for col,label in enumerate(headers,1):
                    cell=sheet.cell(4,col,label); cell.font=Font(name="Fira Sans",bold=True,color=white); cell.fill=PatternFill("solid",fgColor=blue); cell.alignment=Alignment(horizontal="center",vertical="center",wrap_text=True); cell.border=Border(bottom=thin)
                sheet.row_dimensions[4].height=34
                for row_index,values in enumerate(data,5):
                    for col,value in enumerate(values,1):
                        cell=sheet.cell(row_index,col,value if value is not None else "—"); cell.font=Font(name="Fira Sans",size=10,color=ink); cell.alignment=Alignment(vertical="center",wrap_text=True,horizontal="center" if col==1 else "left"); cell.border=Border(bottom=thin)
                        if row_index%2: cell.fill=PatternFill("solid",fgColor="F8FAFC")
                    sheet.row_dimensions[row_index].height=28
                if data: sheet.auto_filter.ref=f"A4:{get_column_letter(len(headers))}{len(data)+4}"
                sheet.freeze_panes="A5"
                for col,width in enumerate(widths,1): sheet.column_dimensions[get_column_letter(col)].width=width
            total=len(students); present_logs=sum(int(row["present"] or 0) for row in rows("SELECT present FROM attendance_log WHERE student_id IN (SELECT id FROM students WHERE group_code=?)",(group_code,)))
            lesson_logs=int(rows("SELECT COUNT(*) AS n FROM attendance_log WHERE student_id IN (SELECT id FROM students WHERE group_code=?)",(group_code,))[0]["n"])
            ranks=sum(1 for a in achievements if "разряд" in a["category"].lower() or "звание" in a["category"].lower())
            gto=sum(1 for a in achievements if "гто" in a["category"].lower())
            teams=sum(1 for a in achievements if ("сборная" in a["category"].lower() or "секция" in a["category"].lower()) and a["status"]!="Исключен")
            events=sum(1 for a in achievements if "мероприят" in a["category"].lower())
            title(overview,"СПбГМТУ · Учет физической культуры и спорта",4)
            summary_rows=[["Состав","Студентов в группе",total],["Здоровье","Основная / подготовительная / специальная",f"{sum(1 for s in students if s['health']=='основная')} / {sum(1 for s in students if s['health']=='подготовительная')} / {sum(1 for s in students if s['health']=='специальная')}"],["Здоровье","Не указано",sum(1 for s in students if s['health']=='не указана')],["ТиМ ФКиС","Зачет / не зачет / не указано",f"{sum(1 for s in students if s['theory']=='зачет')} / {sum(1 for s in students if s['theory']=='не зачет')} / {sum(1 for s in students if s['theory']=='не указано')}"],["Практика ФКиС","Зачет / не зачет / не указано",f"{sum(1 for s in students if s['practice']=='зачет')} / {sum(1 for s in students if s['practice']=='не зачет')} / {sum(1 for s in students if s['practice']=='не указано')}"],["Посещаемость","Отметки присутствия",f"{present_logs} из {lesson_logs}"],["Посещаемость","Доля присутствия",f"{round(present_logs/lesson_logs*100)}%" if lesson_logs else "нет отметок"],["Физическая подготовленность","Записей испытаний",len(tests)],["Спортивное звание / разряд","Записей",ranks],["ВФСК «ГТО»","Записей",gto],["Сборная / спортивная секция","Действующих записей",teams],["Спортивное мероприятие","Записей участника / волонтера",events]]
            table(overview,["Раздел","Показатель","Значение"],summary_rows,[30,45,28])
            roster_rows=[]
            for index,s in enumerate(students,1):
                records=[a for a in achievements if a["student_id"]==s["id"]]
                active=[a for a in records if a["status"] not in ("Исключен","Не действует")]
                teams=[a["team_name"] for a in active if "сборная" in a["category"].lower() and a["team_name"]]
                gto_rows=[a for a in active if "гто" in a["category"].lower()]
                rank_rows=[a for a in active if "разряд" in a["category"].lower() or "звание" in a["category"].lower()]
                event_rows=[a for a in records if "мероприят" in a["category"].lower()]
                roster_rows.append([index,s["isu_id"],s["enrollment_number"],s["name"],s["birth_date"],s["health"],s["theory"],s["theory_date"],s["practice"],s["attendance_pct"]/100,"не указано",", ".join(teams) or "—",", ".join(a["distinction"] or "" for a in gto_rows) or "—",", ".join(a["distinction"] or "" for a in rank_rows) or "—","; ".join(a["event_result"] or a["details"] or "" for a in event_rows) or "—",sum(1 for a in event_rows if a["participant_role"]=="Участник"),sum(1 for a in event_rows if a["participant_role"]=="Волонтер"),sports_organizer or "—"])
            title(roster,"Сводная карточка учебной группы",18)
            table(roster,["№","ISU ID","Номер ЗК","ФИО","Дата рождения","Группа здоровья","ТиМ ФКиС","Дата ТиМ","Практика ФКиС","Посещаемость","Общая оценка ФКиС","Сборная команда","ВФСК «ГТО»","Спортивное звание (разряд)","Спортивное достижение","Участник","Волонтер","Спортивный организатор группы"],roster_rows,[7,14,16,34,16,20,18,14,18,16,20,25,22,26,32,12,12,32])
            fitness_rows=[[next((i for i,student in enumerate(students,1) if student["id"]==test["student_id"]),"—"),test["isu_id"],test["name"],test["test_category"] or "—",test["exercise"],test["result"],test["record_date"]] for test in tests]
            title(fitness,"Физическая подготовленность",7)
            table(fitness,["№","ISU ID","ФИО","Группа испытаний","Физическое упражнение","Результат","Дата выполнения"],fitness_rows,[7,14,34,28,36,25,18])
            sport_rows=[[next((i for i,student in enumerate(students,1) if student["id"]==item["student_id"]),"—"),item["isu_id"],item["name"],item["category"],item["sport_type"],item["team_name"],item["distinction"],item["age_group"],item["participant_role"],item["details"],item["event_status"],item["event_result"],item["record_date"],item["order_basis"],item["document_name"],item["status"],item["note"]] for item in achievements]
            title(sport,"Спортивные достижения студентов",17)
            table(sport,["№","ISU ID","ФИО","Категория","Вид спорта / секция","Сборная","Звание / знак","Возрастная группа","Роль","Мероприятие","Статус мероприятия","Результат / место","Дата","Приказ / основание","Подтверждающий документ","Состояние записи","Примечание"],sport_rows,[7,14,32,27,25,24,26,27,14,30,28,22,16,24,32,18,32])
            attendance_rows=rows("SELECT s.list_position,s.isu_id,s.name,s.health,a.lesson_date,a.topic,a.present FROM attendance_log a JOIN students s ON s.id=a.student_id WHERE s.group_code=? ORDER BY a.lesson_date DESC,s.list_position",(group_code,))
            attendance_data=[[item["list_position"],item["isu_id"],item["name"],item["health"],item["lesson_date"],item["topic"],"Присутствовал" if item["present"] else "Отсутствовал"] for item in attendance_rows]
            title(attendance,"Журнал посещаемости",7)
            table(attendance,["№","ISU ID","ФИО","Группа здоровья","Дата занятия","Дисциплина","Статус"],attendance_data,[7,14,34,21,17,30,20])
            stream=BytesIO(); wb.save(stream); raw=stream.getvalue()
            self.send_response(200); self.send_header("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); self.send_header("Content-Disposition",f"attachment; filename=fkis-{group_code}.xlsx"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw); return
        if path=="/api/bootstrap":
            if DATABASE_URL:
                lesson_date=query.get("date", [date.today().isoformat()])[0]
                discipline=query.get("discipline",[""])[0]; lesson_type=query.get("lesson_type",[""])[0]
                payload=rows(POSTGRES_BOOTSTRAP_QUERY,(group_code,lesson_date,discipline,lesson_type))[0]["data"]
                if isinstance(payload,str): payload=json.loads(payload)
                payload["group"]=group_code
                payload["today"]=date.today().isoformat()
                self.send_json(payload); return
            students=rows("SELECT students.id,students.name,students.health,students.attendance,students.theory,students.practice,students.group_code,students.isu_id,students.enrollment_number,students.study_form,students.list_position,students.birth_date,students.theory_date,students.sport_before,students.elective,CASE WHEN COUNT(a.id)>0 THEN ROUND(100.0*SUM(CASE WHEN a.present THEN 1 ELSE 0 END)/COUNT(a.id)) ELSE students.attendance END AS computed_attendance,COUNT(a.id) AS attendance_records_count,COALESCE(SUM(CASE WHEN a.present THEN 1 ELSE 0 END),0) AS attendance_present_count FROM students LEFT JOIN attendance_log a ON a.student_id=students.id WHERE group_code=? GROUP BY students.id ORDER BY COALESCE(list_position,2147483647),name", (group_code,))
            achievements=rows("SELECT a.id,a.student_id,s.name,a.category,a.details,a.record_date,a.status,a.sport_type,a.distinction,a.age_group,a.order_basis,a.participant_role,a.event_result,a.event_status,a.note,a.document_name,a.team_name FROM achievements a JOIN students s ON s.id=a.student_id WHERE s.group_code=? ORDER BY a.id DESC", (group_code,))
            physical_tests=rows("SELECT p.*,s.name FROM physical_tests p JOIN students s ON s.id=p.student_id WHERE s.group_code=? ORDER BY p.record_date DESC,p.id DESC", (group_code,))
            attendance_records=rows("SELECT student_id,present,topic,discipline,lesson_type,grade FROM attendance_log WHERE lesson_date=? AND discipline=? AND lesson_type=? AND student_id IN (SELECT id FROM students WHERE group_code=?)", (query.get("date", [date.today().isoformat()])[0],query.get("discipline",[""])[0],query.get("lesson_type",[""])[0],group_code)) if query.get("discipline") and query.get("lesson_type") else []
            attendance_trend=rows("SELECT lesson_date,COUNT(*) AS total,SUM(CASE WHEN present THEN 1 ELSE 0 END) AS present FROM attendance_log WHERE student_id IN (SELECT id FROM students WHERE group_code=?) GROUP BY lesson_date ORDER BY lesson_date DESC LIMIT 7", (group_code,))
            summary = {
                "health": rows("SELECT health AS label,COUNT(*) AS count FROM students WHERE group_code=? GROUP BY health ORDER BY health", (group_code,)),
                "theory": rows("SELECT theory AS label,COUNT(*) AS count FROM students WHERE group_code=? GROUP BY theory ORDER BY theory", (group_code,)),
                "practice": rows("SELECT practice AS label,COUNT(*) AS count FROM students WHERE group_code=? GROUP BY practice ORDER BY practice", (group_code,)),
                "achievements": rows("SELECT category AS label,COUNT(*) AS count FROM achievements a JOIN students s ON s.id=a.student_id WHERE s.group_code=? GROUP BY category ORDER BY category", (group_code,)),
                "attendance": rows("SELECT COUNT(*) AS lessons,SUM(CASE WHEN present THEN 1 ELSE 0 END) AS present FROM attendance_log WHERE student_id IN (SELECT id FROM students WHERE group_code=?)", (group_code,))[0]
            }
            group_meta=rows("SELECT sports_organizer FROM academic_groups WHERE group_code=?",(group_code,))
            self.send_json({"students":students,"achievements":achievements,"physical_tests":physical_tests,"attendance_records":attendance_records,"attendance_trend":attendance_trend,"summary":summary,"group":group_code,"sports_organizer":group_meta[0]["sports_organizer"] if group_meta else None,"today":date.today().isoformat()}); return
        if path.startswith("/api/achievement-document/"):
            if self.role_required("Сотрудник ССК «Армада»","Ответственный исполнитель кафедры ФВ","Преподаватель кафедры ФВ"): return
            achievement_id=int(path.rsplit("/",1)[1]); con=connect(); item=con.execute("SELECT document_name,document_data FROM achievements WHERE id=?",(achievement_id,)).fetchone(); con.close()
            if not item or not item[1]: self.send_error(404); return
            raw=bytes(item[1]); name=quote(item[0] or "document.pdf")
            self.send_response(200); self.send_header("Content-Type","application/pdf"); self.send_header("Content-Disposition",f"attachment; filename*=UTF-8''{name}"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw); return
        return super().do_GET()
    def do_PUT(self):
        if self.auth_required(): return
        path=urlparse(self.path).path; data=self.body(); con=connect()
        try:
            if path=="/api/student-health":
                if self.role_required("Ответственный исполнитель кафедры ФВ"): return
                health=data.get("health")
                if health not in ("основная","подготовительная","специальная"): raise ValueError("Выберите основную, подготовительную или специальную группу здоровья.")
                cursor=con.execute("UPDATE students SET health=? WHERE id=?",(health,int(data["student_id"])))
                if cursor.rowcount!=1: raise ValueError("Студент не найден.")
                con.commit(); self.send_json({"ok":True}); return
            if path=="/api/group-organizer":
                if self.role_required("Преподаватель кафедры ФВ","Сотрудник ССК «Армада»"): return
                group_code=str(data.get("group_code","")).strip()
                name=str(data.get("sports_organizer","")).strip()
                if not group_code or len(name)>160: raise ValueError("Проверьте группу и ФИО организатора (до 160 символов).")
                if not con.execute("SELECT 1 FROM academic_groups WHERE group_code=?",(group_code,)).fetchone(): raise ValueError("Выберите существующую группу.")
                con.execute("UPDATE academic_groups SET sports_organizer=? WHERE group_code=?",(name or None,group_code)); con.commit(); self.send_json({"ok":True}); return
            if path.startswith("/api/students/"):
                if self.role_required("Ответственный исполнитель кафедры ФВ"): return
                student_id=int(path.rsplit("/",1)[1])
                con.execute("UPDATE students SET name=?,health=?,attendance=?,theory=?,practice=?,birth_date=?,theory_date=? WHERE id=?",(data["name"].strip(),data["health"],int(data["attendance"]),data["theory"],data["practice"],data.get("birth_date") or None,data.get("theory_date") or None,student_id))
                con.commit(); self.send_json({"ok":True}); return
            if path.startswith("/api/achievements/"):
                if self.role_required("Сотрудник ССК «Армада»"): return
                achievement_id=int(path.rsplit("/",1)[1])
                if data["category"] not in ACHIEVEMENT_CATEGORIES and data["category"]!="Сборная команда (секция)": raise ValueError("Выберите раздел спортивного учета.")
                required={"Спортивное звание (разряд)":("sport_type","distinction"),"ВФСК «ГТО»":("age_group","distinction"),"Сборная команда":("team_name",),"Спортивная секция":("sport_type",),"Спортивное мероприятие":("details","participant_role","event_status"),"Сборная команда (секция)":("team_name",)}[data["category"]]
                if any(not str(data.get(field,"")).strip() for field in required): raise ValueError("Заполните обязательные поля выбранного раздела.")
                document=decode_pdf(data.get("document_base64"))
                con.execute("UPDATE achievements SET student_id=?,category=?,details=?,record_date=?,status=?,sport_type=?,distinction=?,age_group=?,order_basis=?,participant_role=?,event_result=?,event_status=?,note=?,document_name=CASE WHEN ? THEN NULL WHEN ? IS NOT NULL THEN ? ELSE document_name END,document_data=CASE WHEN ? THEN NULL WHEN ? IS NOT NULL THEN ? ELSE document_data END,team_name=? WHERE id=?",(int(data["student_id"]),data["category"],data.get("details","").strip(),data["record_date"],data["status"],data.get("sport_type"),data.get("distinction"),data.get("age_group"),data.get("order_basis"),data.get("participant_role"),data.get("event_result"),data.get("event_status"),data.get("note"),bool(data.get("remove_document")),document,data.get("document_name"),bool(data.get("remove_document")),document,document,data.get("team_name"),achievement_id))
                con.commit(); self.send_json({"ok":True}); return
            self.send_json({"error":"Неизвестный запрос"},404)
        except (KeyError, ValueError, *DB_ERRORS, json.JSONDecodeError, base64.binascii.Error) as e: con.rollback(); self.send_json({"error":str(e)},400)
        finally: con.close()
    def do_POST(self):
        path=urlparse(self.path).path; data=self.body()
        if path == "/api/demo-role":
            if AUTH_ENABLED or data.get("role") not in ROLES:
                self.send_json({"error":"Переключение ролей доступно только в локальном демонстрационном режиме."},403); return
            role=data["role"]
            username=APP_USERNAME
            if role=="Студент":
                username="demo.student@fkis.local"
                if not rows("SELECT 1 FROM student_accounts WHERE email=?",(username,)):
                    salt,digest=password_digest("local-demo-account-not-for-production")
                    con=connect()
                    try: con.execute("INSERT INTO student_accounts(email,password_salt,password_hash) VALUES(?,?,?)",(username,salt,digest)); con.commit()
                    finally: con.close()
            self.send_response(200); self.send_header("Content-Type","application/json; charset=utf-8"); self.set_session_cookie(username,role); self.end_headers(); self.wfile.write(json.dumps({"ok":True,"role":role}).encode()); return
        if path == "/api/register":
            email=str(data.get("email", "")).strip().lower(); password=str(data.get("password", "")); name=" ".join(str(data.get("name", "")).split())
            if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email): self.send_json({"error":"Укажите корректный адрес электронной почты."},400); return
            if len(password)<12: self.send_json({"error":"Пароль должен содержать не менее 12 символов."},400); return
            if len(name.split())<2 or not data.get("birth_date") or not data.get("faculty") or not data.get("course") or data.get("personal_data_consent") is not True:
                self.send_json({"error":"Заполните ФИО, дату рождения, факультет, курс и подтвердите согласие на обработку данных."},400); return
            con=connect()
            try:
                if not con.execute("SELECT 1 FROM academic_groups WHERE group_code=?",(data.get("group_code"),)).fetchone(): raise ValueError("Выберите учебную группу.")
                salt,digest=password_digest(password)
                con.execute("INSERT INTO student_accounts(email,password_salt,password_hash) VALUES(?,?,?)",(email,salt,digest))
                profile={key:data.get(key) for key in ("name","birth_date","group_code","faculty","course","health","sport_before","elective","personal_data_consent","isu_id")}
                if data.get("category"):
                    profile.update({key:data.get(key) for key in ("category","sport_type","distinction","age_group","team_name","section","event_name","event_status","participant_role","event_result","record_date","order_basis","document_name","document_base64")})
                    if data["category"] not in ACHIEVEMENT_CATEGORIES: raise ValueError("Неизвестный раздел достижения.")
                    required={"Спортивное звание (разряд)":("sport_type","distinction"),"ВФСК «ГТО»":("age_group","distinction"),"Сборная команда":("team_name",),"Спортивная секция":("section",),"Спортивное мероприятие":("event_name","participant_role","event_status")}[data["category"]]
                    if any(not str(data.get(field,"")).strip() for field in required): raise ValueError("Заполните обязательные поля выбранного достижения.")
                profile.update({"kind":"profile","email":email})
                con.execute("INSERT INTO student_submissions(email,payload) VALUES(?,?)",(email,json.dumps(profile,ensure_ascii=False)))
                con.commit(); self.send_response(201); self.send_header("Content-Type","application/json; charset=utf-8"); self.set_session_cookie(email,"Студент"); self.end_headers(); self.wfile.write(json.dumps({"ok":True,"message":"Заявка создана и отправлена ответственному исполнителю."},ensure_ascii=False).encode()); return
            except (KeyError,ValueError,*DB_ERRORS) as error:
                con.rollback(); self.send_json({"error":"Такой аккаунт уже существует." if "unique" in str(error).lower() or "duplicate" in str(error).lower() else str(error)},400)
            finally: con.close()
        if path=="/api/login":
            username=str(data.get("username", "")); password=str(data.get("password", ""))
            role=str(data.get("role", ROLES[0])); username=username.strip().lower() if role=="Студент" else username.strip()
            authenticated=False; student_id=None
            if role == "Студент":
                account=rows("SELECT password_salt,password_hash,student_id FROM student_accounts WHERE email=?",(username,))
                if account:
                    salt,digest=password_digest(password,account[0]["password_salt"])
                    authenticated=hmac.compare_digest(digest,account[0]["password_hash"])
                    student_id=account[0]["student_id"]
            elif AUTH_ENABLED and role in ROLES:
                    expected_user,expected_password=ROLE_ACCOUNTS.get(role,("",""))
                    authenticated=bool(expected_password and hmac.compare_digest(username,expected_user) and hmac.compare_digest(password,expected_password))
            elif not AUTH_ENABLED and role in ROLES:
                authenticated=True
            if not authenticated:
                self.send_json({"error":"Неверный логин или пароль."},401); return
            self.send_response(200); self.send_header("Content-Type","application/json; charset=utf-8"); self.set_session_cookie(username,role,student_id); self.end_headers(); self.wfile.write(json.dumps({"ok":True,"role":role}).encode()); return
        if path=="/api/logout":
            self.send_response(200); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Set-Cookie","fkis_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"); self.end_headers(); self.wfile.write(b'{"ok":true}'); return
        if self.auth_required(): return
        con=connect()
        try:
            if path=="/api/student-submissions":
                if self.role_required("Студент"): return
                session=self.session_info()
                payload=dict(data); payload.update({"kind":"achievement" if data.get("category") else "profile","email":session["username"]})
                if not data.get("category") and (len(str(data.get("name","")).split())<2 or not data.get("birth_date") or not data.get("faculty") or not data.get("course") or data.get("personal_data_consent") is not True): raise ValueError("Заполните ФИО, дату рождения, факультет, курс и согласие на обработку персональных данных.")
                if not data.get("category") and not con.execute("SELECT 1 FROM academic_groups WHERE group_code=?",(data.get("group_code"),)).fetchone(): raise ValueError("Выберите учебную группу.")
                if data.get("category") and data["category"] not in ACHIEVEMENT_CATEGORIES: raise ValueError("Выберите раздел спортивного учета.")
                if data.get("category"):
                    required={"Спортивное звание (разряд)":("sport_type","distinction"),"ВФСК «ГТО»":("birth_date","age_group","distinction"),"Сборная команда":("team_name",),"Спортивная секция":("section",),"Спортивное мероприятие":("event_name","participant_role")}[data["category"]]
                    if data["category"] == "Спортивное мероприятие": required += ("event_status",)
                    if any(not str(data.get(field,"")).strip() for field in required): raise ValueError("Заполните обязательные поля выбранного раздела.")
                con.execute("INSERT INTO student_submissions(email,payload) VALUES(?,?)",(session["username"],json.dumps(payload,ensure_ascii=False)))
                con.commit(); self.send_json({"ok":True,"message":"Данные отправлены на проверку ответственному исполнителю."},201); return
            if path.startswith("/api/review-submission/"):
                if self.role_required("Ответственный исполнитель кафедры ФВ"): return
                submission_id=int(path.rsplit("/",1)[1]); status=data.get("status"); note=str(data.get("note", "")).strip()
                if status not in ("Подтверждено","Отклонено") or (status=="Отклонено" and not note): raise ValueError("Укажите решение; при отказе обязательно напишите причину.")
                item=con.execute("SELECT * FROM student_submissions WHERE id=?",(submission_id,)).fetchone()
                if not item or item["status"]!="На проверке": raise ValueError("Заявка уже рассмотрена или не найдена.")
                payload=json.loads(item["payload"]); email=item["email"]; student_id=None
                if status=="Подтверждено":
                    if payload.get("kind")=="profile":
                        group=payload["group_code"]; isu_id=str(payload.get("isu_id") or "").strip() or None
                        account=con.execute("SELECT student_id FROM student_accounts WHERE email=?",(email,)).fetchone()
                        existing=con.execute("SELECT id FROM students WHERE id=?",(account["student_id"],)).fetchone() if account and account["student_id"] else con.execute("SELECT id FROM students WHERE group_code=? AND ((? IS NOT NULL AND isu_id=?) OR name=?) LIMIT 1",(group,isu_id,isu_id,payload["name"])).fetchone()
                        if existing:
                            linked=con.execute("SELECT email FROM students WHERE id=?",(existing["id"],)).fetchone()
                            if linked["email"] and linked["email"].lower()!=email.lower(): raise ValueError("Эта карточка уже связана с другой учетной записью. Проверьте заявку вручную.")
                            student_id=existing["id"]
                        else:
                            cursor=con.execute("INSERT INTO students(name,health,attendance,theory,practice,group_code,birth_date,email,faculty,course,sport_before,elective,personal_data_consent,isu_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id",(payload["name"],payload.get("health") or "не указана",0,"не указано","не указано",group,payload.get("birth_date"),email,payload.get("faculty"),int(payload["course"]),payload.get("sport_before"),payload.get("elective"),True,isu_id)); student_id=cursor.fetchone()["id"]
                        con.execute("UPDATE students SET name=?,group_code=?,health=?,birth_date=?,email=?,faculty=?,course=?,sport_before=?,elective=?,personal_data_consent=?,isu_id=COALESCE(isu_id,?) WHERE id=?",(payload["name"],group,payload.get("health") or "не указана",payload.get("birth_date"),email,payload.get("faculty"),int(payload["course"]),payload.get("sport_before"),payload.get("elective"),True,isu_id,student_id))
                        con.execute("UPDATE student_accounts SET student_id=? WHERE email=?",(student_id,email))
                        if payload.get("category"):
                            category=payload["category"]
                            if category not in ACHIEVEMENT_CATEGORIES: raise ValueError("Неизвестный раздел достижения.")
                            required={"Спортивное звание (разряд)":("sport_type","distinction"),"ВФСК «ГТО»":("age_group","distinction"),"Сборная команда":("team_name",),"Спортивная секция":("section",),"Спортивное мероприятие":("event_name","participant_role","event_status")}[category]
                            if any(not str(payload.get(field,"")).strip() for field in required): raise ValueError("Заполните обязательные поля достижения в заявке.")
                            document=decode_pdf(payload.get("document_base64"))
                            con.execute("INSERT INTO achievements(student_id,category,details,record_date,status,sport_type,distinction,age_group,order_basis,participant_role,event_result,event_status,team_name,document_name,document_data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(student_id,category,payload.get("event_name", ""),payload.get("record_date") or date.today().isoformat(),"Подтверждено",payload.get("sport_type") or payload.get("section"),payload.get("distinction"),payload.get("age_group"),payload.get("order_basis"),payload.get("participant_role"),payload.get("event_result"),payload.get("event_status"),payload.get("team_name"),payload.get("document_name"),document))
                    elif payload.get("kind")=="achievement":
                        account=con.execute("SELECT student_id FROM student_accounts WHERE email=?",(email,)).fetchone()
                        if not account or not account["student_id"]: raise ValueError("Сначала подтвердите профиль студента.")
                        student_id=account["student_id"]; category=payload["category"]
                        fields={"student_id":student_id,"category":category,"details":payload.get("event_name", ""),"record_date":payload.get("record_date") or date.today().isoformat(),"status":"Подтверждено","sport_type":payload.get("sport_type") or payload.get("section"),"distinction":payload.get("distinction"),"age_group":payload.get("age_group"),"order_basis":payload.get("order_basis"),"participant_role":payload.get("participant_role"),"event_result":payload.get("event_result"),"event_status":payload.get("event_status"),"note":payload.get("note"),"document_name":payload.get("document_name"),"document_data":decode_pdf(payload.get("document_base64")),"team_name":payload.get("team_name")}
                        con.execute("INSERT INTO achievements(student_id,category,details,record_date,status,sport_type,distinction,age_group,order_basis,participant_role,event_result,event_status,note,document_name,document_data,team_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",tuple(fields.values()))
                    else: raise ValueError("Неизвестный тип заявки.")
                con.execute("UPDATE student_submissions SET status=?,review_note=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?",(status,note or None,submission_id)); con.commit()
                notice="Данные подтверждены." if status=="Подтверждено" else f"Заявка отклонена. Причина: {note}"
                email_sent=notify_student(email,"Результат проверки данных ФКиС СПбГМТУ",notice)
                self.send_json({"ok":True,"email_sent":email_sent}); return
            if path=="/api/attendance":
                if self.role_required("Преподаватель кафедры ФВ"): return
                discipline=data.get("discipline"); lesson_type=data.get("lesson_type")
                allowed=LESSON_TYPES if discipline==FITNESS_DISCIPLINES[0] else FITNESS_ACTIVITIES if discipline==FITNESS_DISCIPLINES[1] else ()
                if lesson_type not in allowed: raise ValueError("Выберите занятие для указанной дисциплины.")
                for item in data.get("items",[]): con.execute("INSERT INTO attendance_log(student_id,lesson_date,topic,discipline,lesson_type,grade,present) VALUES(?,?,?,?,?,?,?) ON CONFLICT(student_id,lesson_date,discipline,lesson_type) DO UPDATE SET topic=excluded.topic,grade=excluded.grade,present=excluded.present",(item["id"],data.get("lesson_date"),lesson_type,discipline,lesson_type,item.get("grade"),bool(item["present"])))
                con.commit(); self.send_json({"ok":True}); return
            if path=="/api/physical-tests":
                if self.role_required("Преподаватель кафедры ФВ"): return
                category=data.get("test_category")
                if category not in PHYSICAL_CATEGORIES: raise ValueError("Выберите группу физического испытания.")
                if not str(data.get("exercise","")).strip() or not str(data.get("result","")).strip(): raise ValueError("Укажите упражнение и результат.")
                con.execute("INSERT INTO physical_tests(student_id,record_date,exercise,test_category,result,grade) VALUES(?,?,?,?,?,?) ON CONFLICT(student_id,record_date,exercise) DO UPDATE SET test_category=excluded.test_category,result=excluded.result,grade=excluded.grade",(int(data["student_id"]),data["record_date"],data["exercise"].strip(),category,data["result"].strip(),data.get("grade")))
                con.commit(); self.send_json({"ok":True}); return
            if path=="/api/achievements":
                if self.role_required("Сотрудник ССК «Армада»"): return
                if data["category"] not in ACHIEVEMENT_CATEGORIES: raise ValueError("Выберите раздел спортивного учета.")
                required={"Спортивное звание (разряд)":("sport_type","distinction"),"ВФСК «ГТО»":("age_group","distinction"),"Сборная команда":("team_name",),"Спортивная секция":("sport_type",),"Спортивное мероприятие":("details","participant_role","event_status")}[data["category"]]
                if any(not str(data.get(field,"")).strip() for field in required): raise ValueError("Заполните обязательные поля выбранного раздела.")
                document=decode_pdf(data.get("document_base64"))
                con.execute("INSERT INTO achievements(student_id,category,details,record_date,status,sport_type,distinction,age_group,order_basis,participant_role,event_result,event_status,note,document_name,document_data,team_name) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(int(data["student_id"]),data["category"],data.get("details","").strip(),data.get("record_date") or date.today().strftime("%d.%m.%Y"),data.get("status","Подтверждено"),data.get("sport_type"),data.get("distinction"),data.get("age_group"),data.get("order_basis"),data.get("participant_role"),data.get("event_result"),data.get("event_status"),data.get("note"),data.get("document_name"),document,data.get("team_name"))); con.commit(); self.send_json({"ok":True},201); return
            if path=="/api/students":
                if self.role_required("Ответственный исполнитель кафедры ФВ"): return
                group_code=data.get("group_code",DEFAULT_GROUP)
                if not con.execute("SELECT 1 FROM academic_groups WHERE group_code=?",(group_code,)).fetchone(): raise ValueError("Выберите группу из списка ИСУ.")
                cur=con.execute("INSERT INTO students(name,health,attendance,theory,practice,group_code) VALUES(?,?,?,?,?,?) RETURNING id",(data["name"],data.get("health","не указана"),0,"не указано","не указано",group_code)); student_id=cur.fetchone()["id"]; con.commit(); self.send_json({"id":student_id},201); return
            self.send_json({"error":"Неизвестный запрос"},404)
        except (KeyError, ValueError, *DB_ERRORS, json.JSONDecodeError, base64.binascii.Error) as e: con.rollback(); self.send_json({"error":str(e)},400)
        finally: con.close()

if __name__=="__main__":
    init_db()
    port=int(os.environ.get("PORT", "4174"))
    print(f"http://127.0.0.1:{port}")
    bind_host="0.0.0.0" if os.environ.get("PORT") or DATABASE_URL else "127.0.0.1"
    ThreadingHTTPServer((bind_host,port),App).serve_forever()
