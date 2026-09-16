import json
import sqlite3
from datetime import date
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB = ROOT / "fkis.db"

SEED = [
    ("Александрова Мария Игоревна","основная",92,"зачет","зачет"),("Белов Кирилл Денисович","основная",86,"зачет","зачет"),("Васильева Елизавета Сергеевна","подготовительная",78,"зачет","зачет"),("Гром Никита Олегович","основная",95,"зачет","зачет"),("Данилов Артём Максимович","основная",68,"зачет","не зачет"),("Егорова Полина Вадимовна","основная",88,"зачет","зачет"),("Жуков Андрей Петрович","специальная",72,"зачет","зачет"),("Зайцева Ксения Романовна","основная",91,"зачет","зачет"),("Иванов Илья Андреевич","основная",96,"зачет","зачет"),("Калинин Максим Олегович","подготовительная",83,"зачет","зачет"),("Кириллова Дарья Николаевна","основная",89,"зачет","зачет"),("Козлов Михаил Аркадьевич","основная",64,"не зачет","не зачет"),("Комарова Софья Павловна","основная",90,"зачет","зачет"),("Кузнецов Денис Викторович","подготовительная",75,"зачет","зачет"),("Лебедева Анна Дмитриевна","основная",87,"зачет","зачет"),("Мельникова Виктория Олеговна","основная",93,"зачет","зачет"),("Морозов Павел Андреевич","основная",69,"зачет","не зачет"),("Николаева Арина Максимовна","специальная",76,"зачет","зачет"),("Орлов Владислав Сергеевич","основная",85,"зачет","зачет"),("Павлова Кира Алексеевна","подготовительная",82,"зачет","зачет"),("Петров Арсений Владиславович","основная",89,"зачет","зачет"),("Романова Вероника Олеговна","основная",94,"зачет","зачет"),("Смирнов Егор Ильич","основная",66,"не зачет","не зачет"),("Соколова Алиса Дмитриевна","подготовительная",80,"зачет","зачет"),("Тарасов Матвей Романович","основная",88,"зачет","зачет"),("Фёдорова Ева Максимовна","основная",91,"зачет","зачет"),("Харитонов Лев Евгеньевич","подготовительная",74,"зачет","зачет"),("Чернова Алина Викторовна","основная",87,"зачет","зачет")]

def connect():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    con = connect()
    con.executescript("""
      CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT NOT NULL, health TEXT NOT NULL, attendance INTEGER NOT NULL DEFAULT 0, theory TEXT NOT NULL DEFAULT 'не зачет', practice TEXT NOT NULL DEFAULT 'не зачет');
      CREATE TABLE IF NOT EXISTS attendance_log (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), lesson_date TEXT NOT NULL, topic TEXT NOT NULL, present INTEGER NOT NULL, UNIQUE(student_id, lesson_date));
      CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), category TEXT NOT NULL, details TEXT NOT NULL, record_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Подтверждено');
      CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_log(student_id, lesson_date);
      CREATE INDEX IF NOT EXISTS idx_achievements_student ON achievements(student_id);
    """)
    if con.execute("SELECT COUNT(*) FROM students").fetchone()[0] == 0:
        con.executemany("INSERT INTO students(name,health,attendance,theory,practice) VALUES(?,?,?,?,?)", SEED)
        rows = con.execute("SELECT id FROM students").fetchall()
        con.executemany("INSERT INTO attendance_log(student_id,lesson_date,topic,present) VALUES(?,?,?,?)", [(r[0], "2026-09-16", "Общая физическая подготовка", 0 if r[0] in (5,12,17,23) else 1) for r in rows])
        con.executemany("INSERT INTO achievements(student_id,category,details,record_date,status) VALUES(?,?,?,?,?)", [(9,"Спортивный разряд","Мастер спорта · мини-футбол","12.09.2026","Действующий"),(4,"ВФСК «ГТО»","Золотой знак · VII ступень","10.09.2026","Подтверждено"),(1,"Мероприятие","Участник · Спартакиада СПбГМТУ","08.09.2026","Подтверждено"),(21,"Мероприятие","Волонтер · День спорта","05.09.2026","Подтверждено"),(14,"Спортивный разряд","КМС · плавание","01.09.2026","Действующий")])
    con.commit(); con.close()

def rows(sql, args=()):
    con = connect(); result = [dict(r) for r in con.execute(sql,args).fetchall()]; con.close(); return result

class App(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args, directory=str(ROOT), **kwargs)
    def send_json(self, value, status=200):
        raw=json.dumps(value,ensure_ascii=False).encode(); self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def body(self): return json.loads(self.rfile.read(int(self.headers.get("Content-Length",0))) or b"{}")
    def do_GET(self):
        path=urlparse(self.path).path
        if path=="/api/bootstrap":
            students=rows("SELECT *, EXISTS(SELECT 1 FROM attendance_log a WHERE a.student_id=students.id AND a.lesson_date='2026-09-16' AND a.present=1) AS present FROM students ORDER BY name")
            achievements=rows("SELECT a.id,s.name,a.category,a.details,a.record_date,a.status FROM achievements a JOIN students s ON s.id=a.student_id ORDER BY a.id DESC")
            self.send_json({"students":students,"achievements":achievements,"today":"2026-09-16"}); return
        return super().do_GET()
    def do_POST(self):
        path=urlparse(self.path).path; data=self.body(); con=connect()
        try:
            if path=="/api/attendance":
                for item in data.get("items",[]): con.execute("INSERT INTO attendance_log(student_id,lesson_date,topic,present) VALUES(?,?,?,?) ON CONFLICT(student_id,lesson_date) DO UPDATE SET topic=excluded.topic,present=excluded.present",(item["id"],data.get("lesson_date","2026-09-16"),data.get("topic","Общая физическая подготовка"),int(item["present"])))
                con.commit(); self.send_json({"ok":True}); return
            if path=="/api/achievements":
                con.execute("INSERT INTO achievements(student_id,category,details,record_date,status) VALUES(?,?,?,?,?)",(data["student_id"],data["category"],data["details"],date.today().strftime("%d.%m.%Y"),"Подтверждено")); con.commit(); self.send_json({"ok":True}); return
            if path=="/api/students":
                cur=con.execute("INSERT INTO students(name,health,attendance,theory,practice) VALUES(?,?,?,?,?)",(data["name"],data.get("health","основная"),0,"не зачет","не зачет")); con.commit(); self.send_json({"id":cur.lastrowid},201); return
            self.send_json({"error":"Неизвестный запрос"},404)
        except (KeyError, sqlite3.Error, json.JSONDecodeError) as e: con.rollback(); self.send_json({"error":str(e)},400)
        finally: con.close()

if __name__=="__main__":
    init_db(); print("http://127.0.0.1:4174"); ThreadingHTTPServer(("127.0.0.1",4174),App).serve_forever()
