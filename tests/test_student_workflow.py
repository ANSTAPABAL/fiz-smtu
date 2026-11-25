import base64
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class StudentWorkflowTest(unittest.TestCase):
    def test_review_and_semester_history(self):
        with tempfile.TemporaryDirectory() as tmp, patch.multiple(
            server, DB=Path(tmp) / "test.db", DATABASE_URL="", AUTH_ENABLED=True,
            ROLE_ACCOUNTS={server.ROLES[3]: ("test-reviewer", "test-reviewer-password")},
        ), patch.object(server, "notify_student", return_value=True) as notify:
            server.init_db()
            con = server.connect()
            con.execute("INSERT INTO academic_groups(group_code,display_code,faculty,course) VALUES(?,?,?,?)",
                        ("demo", "Демо-01", "Тестовый факультет", 1))
            con.commit()
            con.close()
            httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.App)
            thread = threading.Thread(target=httpd.serve_forever)
            thread.start()
            self.addCleanup(thread.join)
            self.addCleanup(httpd.server_close)
            self.addCleanup(httpd.shutdown)

            def request(path, status=200, data=None, cookie=""):
                connection = http.client.HTTPConnection(*httpd.server_address, timeout=5)
                try:
                    body = json.dumps(data).encode() if data is not None else None
                    connection.request("POST" if body else "GET", path, body, {"Cookie": cookie})
                    response = connection.getresponse()
                    content = response.read()
                    self.assertEqual(response.status, status, content.decode(errors="replace"))
                    if response.getheader("Content-Type") == "application/pdf":
                        return content, ""
                    return json.loads(content), (response.getheader("Set-Cookie") or "").split(";")[0]
                finally:
                    connection.close()

            pdf = b"%PDF-1.4\n"
            encoded = base64.b64encode(pdf).decode()
            profile = {"name": "Демонстрационный Студент", "email": "student@example.test",
                       "password": "test-student-password", "group_code": "demo",
                       "birth_date": "2000-01-01", "faculty": "Тестовый факультет", "course": 1,
                       "sport_before": "Плавание", "prior_rank": "Первый разряд",
                       "prior_gto": "Золотой знак", "personal_data_consent": True,
                       "prior_document_name": "rank.pdf", "prior_document_base64": encoded}
            _, student = request("/api/register", 201, profile)
            request("/api/register", 400, profile)
            _, reviewer = request("/api/login", data={"username": "test-reviewer",
                                  "password": "test-reviewer-password", "role": server.ROLES[3]})

            def pending():
                items, _ = request("/api/pending-submissions", cookie=reviewer)
                self.assertEqual(len(items["submissions"]), 1)
                return items["submissions"][0]

            def review(item, status, note=""):
                return request(f"/api/review-submission/{item['id']}",
                               data={"status": status, "note": note}, cookie=reviewer)

            item = pending()
            self.assertEqual(item["group_name"], "Демо-01")
            self.assertTrue(item["has_prior_document"])
            self.assertNotIn("health", item["payload"])
            self.assertNotIn("elective", item["payload"])
            proof = f"/api/submission-document/{item['id']}?kind=prior"
            request(proof, 403, cookie=student)
            self.assertEqual(request(proof, cookie=reviewer)[0], pdf)
            choice = {"health": "основная", "elective": "Плавание", "elective_semester": "2"}
            request("/api/student-submissions", 400, choice, student)
            review(item, "Отклонено", "Поправьте регистрацию")
            self.assertEqual(notify.call_args.args[0], profile["email"])
            current, _ = request("/api/student-data", cookie=student)
            self.assertEqual(current["submission"]["review_note"], "Поправьте регистрацию")
            correction = {key: value for key, value in profile.items() if key not in ("password", "prior_document_base64")}
            correction["correct_registration"] = True
            request("/api/register", 201, correction, student)
            request("/api/register", 400, correction, student)
            item = pending()
            self.assertTrue(item["has_prior_document"])
            review(item, "Подтверждено")

            request("/api/student-submissions", 400, choice, student)
            request("/api/student-submissions", 400, dict(choice, elective_semester="1", health_document_base64=encoded), student)
            request("/api/student-submissions", 201, dict(choice, health_document_name="health.pdf", health_document_base64=encoded), student)
            request("/api/student-submissions", 400, dict(choice, health_document_base64=encoded), student)
            item = pending()
            self.assertEqual(item["payload"]["kind"], "health_elective")
            self.assertEqual(item["student_name"], profile["name"])
            self.assertEqual(item["group_name"], "Демо-01")
            self.assertNotIn("name", item["payload"])
            self.assertNotIn("health_document_base64", item["payload"])
            proof = f"/api/submission-document/{item['id']}?kind=health"
            request(proof, 403, cookie=student)
            self.assertEqual(request(proof, cookie=reviewer)[0], pdf)
            review(item, "Отклонено", "Поправьте электив")
            request("/api/student-submissions", 201, dict(choice, elective="Фитнес"), student)
            item = pending()
            self.assertTrue(item["has_health_document"])
            review(item, "Подтверждено")
            request("/api/student-submissions", 400, dict(choice, health_document_base64=encoded), student)
            current, _ = request("/api/student-data", cookie=student)
            self.assertEqual(current["electives"], {"2": "Фитнес"})
            self.assertEqual(current["student"]["prior_rank"], "Первый разряд")
            self.assertEqual(set(award["distinction"] for award in current["achievements"]), {"Первый разряд", "Золотой знак"})
            summary, _ = request("/api/group-health-summary", cookie=reviewer)
            self.assertEqual(summary["rows"], [{"faculty": "Тестовый факультет", "group_name": "Демо-01",
                                               "health": "основная", "elective": "Фитнес", "total": 1}])
