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
            profile = {"name": "Демонстрационный Студент", "email": "student@example.test",
                       "password": "test-student-password", "group_code": "demo",
                       "birth_date": "2000-01-01", "faculty": "Тестовый факультет", "course": 1,
                       "health": "основная", "elective": "Плавание", "elective_semester": "2",
                       "prior_rank": "б/р", "prior_gto": "Золотой знак", "personal_data_consent": True,
                       "health_document_name": "test.pdf", "health_document_base64": base64.b64encode(pdf).decode()}
            _, student = request("/api/register", 201, profile)
            _, reviewer = request("/api/login", data={"username": "test-reviewer",
                                  "password": "test-reviewer-password", "role": server.ROLES[3]})

            def pending():
                items, _ = request("/api/pending-submissions", cookie=reviewer)
                return items["submissions"][0]

            item = pending()
            self.assertEqual(item["group_name"], "Демо-01")
            self.assertTrue(item["has_health_document"])
            self.assertNotIn("health_document_base64", item["payload"])
            path = f"/api/submission-document/{item['id']}?kind=health"
            request(path, 403, cookie=student)
            self.assertEqual(request(path, cookie=reviewer)[0], pdf)
            request(f"/api/review-submission/{item['id']}", data={"status": "Отклонено", "note": "Поправьте"}, cookie=reviewer)
            self.assertEqual(notify.call_args.args[0], profile["email"])
            current, _ = request("/api/student-data", cookie=student)
            self.assertEqual(current["submission"]["payload"]["elective"], "Плавание")
            self.assertEqual(current["submission"]["review_note"], "Поправьте")
            profile.pop("password")
            profile.pop("health_document_base64")
            profile.pop("health_document_name")
            profile["reuse_health_document_from"] = item["id"]
            for semester, elective in (("2", "Плавание"), ("3", "Фитнес")):
                request("/api/student-submissions", 201, dict(profile, elective_semester=semester, elective=elective), student)
                item = pending()
                self.assertTrue(item["has_health_document"])
                path = f"/api/review-submission/{item['id']}"
                request(path, data={"status": "Подтверждено"}, cookie=reviewer)
                request(path, 400, {"status": "Подтверждено"}, reviewer)
            current, _ = request("/api/student-data", cookie=student)
            self.assertEqual(current["electives"], {"2": "Плавание", "3": "Фитнес"})
            self.assertEqual(current["student"]["prior_rank"], "б/р")
            self.assertEqual([award["distinction"] for award in current["achievements"]], ["Золотой знак"])
            summary, _ = request("/api/group-health-summary", cookie=reviewer)
            self.assertEqual(summary["rows"], [{"faculty": "Тестовый факультет", "group_name": "Демо-01",
                                               "health": "основная", "elective": "Фитнес", "total": 1}])
