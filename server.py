import json
import sqlite3
from datetime import date
from io import BytesIO
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parent
DB = ROOT / "fkis.db"

SEED = [
    ("Александрова Мария Игоревна","основная",92,"зачет","зачет"),("Белов Кирилл Денисович","основная",86,"зачет","зачет"),("Васильева Елизавета Сергеевна","подготовительная",78,"зачет","зачет"),("Гром Никита Олегович","основная",95,"зачет","зачет"),("Данилов Артём Максимович","основная",68,"зачет","не зачет"),("Егорова Полина Вадимовна","основная",88,"зачет","зачет"),("Жуков Андрей Петрович","специальная",72,"зачет","зачет"),("Зайцева Ксения Романовна","основная",91,"зачет","зачет"),("Иванов Илья Андреевич","основная",96,"зачет","зачет"),("Калинин Максим Олегович","подготовительная",83,"зачет","зачет"),("Кириллова Дарья Николаевна","основная",89,"зачет","зачет"),("Козлов Михаил Аркадьевич","основная",64,"не зачет","не зачет"),("Комарова Софья Павловна","основная",90,"зачет","зачет"),("Кузнецов Денис Викторович","подготовительная",75,"зачет","зачет"),("Лебедева Анна Дмитриевна","основная",87,"зачет","зачет"),("Мельникова Виктория Олеговна","основная",93,"зачет","зачет"),("Морозов Павел Андреевич","основная",69,"зачет","не зачет"),("Николаева Арина Максимовна","специальная",76,"зачет","зачет"),("Орлов Владислав Сергеевич","основная",85,"зачет","зачет"),("Павлова Кира Алексеевна","подготовительная",82,"зачет","зачет"),("Петров Арсений Владиславович","основная",89,"зачет","зачет"),("Романова Вероника Олеговна","основная",94,"зачет","зачет"),("Смирнов Егор Ильич","основная",66,"не зачет","не зачет"),("Соколова Алиса Дмитриевна","подготовительная",80,"зачет","зачет"),("Тарасов Матвей Романович","основная",88,"зачет","зачет"),("Фёдорова Ева Максимовна","основная",91,"зачет","зачет"),("Харитонов Лев Евгеньевич","подготовительная",74,"зачет","зачет"),("Чернова Алина Викторовна","основная",87,"зачет","зачет")]
GROUPS = ["12509-05","12509-01","12509-02","12509-03","12509-04","12510-01","12510-02","12511-01","12609-01"]
ALT_LAST_NAMES = ["Алексеев","Барсукова","Власов","Гаврилова","Демидов","Елисеев","Зорина","Касаткин","Ларионова","Мартынов","Нестеров","Орехова","Панфилов","Руднева","Савельев","Тихонова","Уваров","Фролова","Хмелёв","Цветкова","Чистяков","Шарыпова","Щербаков","Юдина","Яковлев","Белозёров","Виноградова","Горшков"]

def connect():
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    con = connect()
    con.executescript("""
      CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, name TEXT NOT NULL, health TEXT NOT NULL, attendance INTEGER NOT NULL DEFAULT 0, theory TEXT NOT NULL DEFAULT 'не зачет', practice TEXT NOT NULL DEFAULT 'не зачет', group_code TEXT NOT NULL DEFAULT '12509-05');
      CREATE TABLE IF NOT EXISTS attendance_log (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), lesson_date TEXT NOT NULL, topic TEXT NOT NULL, present INTEGER NOT NULL, UNIQUE(student_id, lesson_date));
      CREATE TABLE IF NOT EXISTS achievements (id INTEGER PRIMARY KEY, student_id INTEGER NOT NULL REFERENCES students(id), category TEXT NOT NULL, details TEXT NOT NULL, record_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Подтверждено');
      CREATE INDEX IF NOT EXISTS idx_attendance_student_date ON attendance_log(student_id, lesson_date);
      CREATE INDEX IF NOT EXISTS idx_achievements_student ON achievements(student_id);
    """)
    columns = [r[1] for r in con.execute("PRAGMA table_info(students)")]
    if "group_code" not in columns:
        con.execute("ALTER TABLE students ADD COLUMN group_code TEXT NOT NULL DEFAULT '12509-05'")
    con.execute("CREATE INDEX IF NOT EXISTS idx_students_group ON students(group_code)")
    if con.execute("SELECT COUNT(*) FROM students").fetchone()[0] == 0:
        con.executemany("INSERT INTO students(name,health,attendance,theory,practice,group_code) VALUES(?,?,?,?,?,?)", [(*s,"12509-05") for s in SEED])
    for group_index, group_code in enumerate(GROUPS):
        if con.execute("SELECT COUNT(*) FROM students WHERE group_code=?", (group_code,)).fetchone()[0] == 0:
            generated=[]
            for index, (name, health, attendance, theory, practice) in enumerate(SEED):
                first, middle = name.split()[1:]
                generated.append((f"{ALT_LAST_NAMES[(index + group_index * 3) % len(ALT_LAST_NAMES)]} {first} {middle}", health, max(58, min(98, attendance - group_index % 5 * 3)), theory, practice, group_code))
            con.executemany("INSERT INTO students(name,health,attendance,theory,practice,group_code) VALUES(?,?,?,?,?,?)", generated)
    if con.execute("SELECT COUNT(*) FROM attendance_log").fetchone()[0] == 0:
        rows = con.execute("SELECT id FROM students").fetchall()
        con.executemany("INSERT INTO attendance_log(student_id,lesson_date,topic,present) VALUES(?,?,?,?)", [(r[0], "2026-09-16", "Общая физическая подготовка", 0 if r[0] in (5,12,17,23) else 1) for r in rows])
    if con.execute("SELECT COUNT(*) FROM achievements").fetchone()[0] == 0:
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
        query=parse_qs(urlparse(self.path).query)
        group_code=query.get("group", ["12509-05"])[0]
        if group_code not in GROUPS: group_code="12509-05"
        if path=="/api/export.xlsx":
            students=rows("SELECT name,health,attendance,theory,practice FROM students WHERE group_code=? ORDER BY name", (group_code,))
            wb=Workbook(); ws=wb.active; ws.title=f"Группа {group_code}"
            navy="455273"; blue="517CB3"; orange="FF5500"; pale="EDF4FB"; line="D9E2F0"
            ws.merge_cells("A1:E1"); ws["A1"]="СПбГМТУ · Учет физической культуры и спорта"; ws["A1"].font=Font(name="Fira Sans",size=16,bold=True,color="FFFFFF"); ws["A1"].fill=PatternFill("solid",fgColor=navy); ws["A1"].alignment=Alignment(horizontal="center",vertical="center"); ws.row_dimensions[1].height=32
            ws.merge_cells("A2:E2"); ws["A2"]=f"Сводная ведомость группы {group_code} · осенний семестр 2026"; ws["A2"].font=Font(name="Fira Sans",size=11,color="455273",bold=True); ws["A2"].fill=PatternFill("solid",fgColor=pale); ws["A2"].alignment=Alignment(horizontal="center"); ws.row_dimensions[2].height=23
            headers=["Студент","Группа здоровья","Посещаемость","ТиМ ФКиС","Практика ФКиС"]
            for col,value in enumerate(headers,1):
                cell=ws.cell(4,col,value); cell.font=Font(name="Fira Sans",bold=True,color="FFFFFF"); cell.fill=PatternFill("solid",fgColor=blue); cell.alignment=Alignment(horizontal="center",vertical="center",wrap_text=True)
            thin=Side(style="thin",color=line)
            for row_idx,s in enumerate(students,5):
                values=[s["name"],s["health"],s["attendance"]/100,s["theory"],s["practice"]]
                for col,value in enumerate(values,1):
                    cell=ws.cell(row_idx,col,value); cell.font=Font(name="Fira Sans",size=10,color="212529"); cell.alignment=Alignment(vertical="center",horizontal="center" if col>1 else "left"); cell.border=Border(bottom=thin)
                    if row_idx%2: cell.fill=PatternFill("solid",fgColor="F8FAFC")
                ws.cell(row_idx,3).number_format="0%"
            total=len(students); start=5; end=total+4; r=end+2
            ws.merge_cells(start_row=r,start_column=1,end_row=r,end_column=2); ws.cell(r,1,"Итоги по группе"); ws.cell(r,1).font=Font(name="Fira Sans",bold=True,color="FFFFFF"); ws.cell(r,1).fill=PatternFill("solid",fgColor=navy); ws.cell(r,1).alignment=Alignment(horizontal="center")
            ws.cell(r,3,"Студентов"); ws.cell(r,4,total); ws.cell(r+1,3,"Средняя посещаемость"); ws.cell(r+1,4,f"=AVERAGE(C{start}:C{end})"); ws.cell(r+1,4).number_format="0%"
            for rr in (r,r+1):
                for cc in range(3,5): ws.cell(rr,cc).fill=PatternFill("solid",fgColor=pale); ws.cell(rr,cc).font=Font(name="Fira Sans",bold=cc==3,color="455273")
            for col,width in {1:35,2:22,3:17,4:16,5:17}.items(): ws.column_dimensions[get_column_letter(col)].width=width
            ws.freeze_panes="A5"; ws.auto_filter.ref=f"A4:E{end}"; ws.sheet_view.showGridLines=False
            stream=BytesIO(); wb.save(stream); raw=stream.getvalue()
            self.send_response(200); self.send_header("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); self.send_header("Content-Disposition","attachment; filename=fkis-12509-05.xlsx"); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw); return
        if path=="/api/bootstrap":
            students=rows("SELECT *, EXISTS(SELECT 1 FROM attendance_log a WHERE a.student_id=students.id AND a.lesson_date='2026-09-16' AND a.present=1) AS present FROM students WHERE group_code=? ORDER BY name", (group_code,))
            achievements=rows("SELECT a.id,s.name,a.category,a.details,a.record_date,a.status FROM achievements a JOIN students s ON s.id=a.student_id WHERE s.group_code=? ORDER BY a.id DESC", (group_code,))
            self.send_json({"students":students,"achievements":achievements,"group":group_code,"today":"2026-09-16"}); return
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
                group_code=data.get("group_code","12509-05") if data.get("group_code") in GROUPS else "12509-05"
                cur=con.execute("INSERT INTO students(name,health,attendance,theory,practice,group_code) VALUES(?,?,?,?,?,?)",(data["name"],data.get("health","основная"),0,"не зачет","не зачет",group_code)); con.commit(); self.send_json({"id":cur.lastrowid},201); return
            self.send_json({"error":"Неизвестный запрос"},404)
        except (KeyError, sqlite3.Error, json.JSONDecodeError) as e: con.rollback(); self.send_json({"error":str(e)},400)
        finally: con.close()

if __name__=="__main__":
    init_db(); print("http://127.0.0.1:4174"); ThreadingHTTPServer(("127.0.0.1",4174),App).serve_forever()
