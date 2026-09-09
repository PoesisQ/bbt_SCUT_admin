import unittest
from types import SimpleNamespace
import httpx
from assistant_service.connection_check import check


class ConnectionTests(unittest.TestCase):
    def test_authentication_probe_has_no_course_text_and_no_key_in_response(self):
        settings=SimpleNamespace(key=lambda:"unit-test-key",data={"deepseek_model":"example-model"})
        def handle(request):
            self.assertEqual(str(request.url),"https://api.deepseek.com/models")
            self.assertEqual(request.method,"GET")
            self.assertEqual(request.content,b"")
            return httpx.Response(200,json={"data":[{"id":"example-model"}]})
        result=check(settings,httpx.MockTransport(handle))
        self.assertTrue(result["ok"])
        self.assertNotIn("unit-test-key",str(result))

    def test_failed_auth_and_missing_model_are_not_reported_as_connected(self):
        settings=SimpleNamespace(key=lambda:"unit-test-key",data={"deepseek_model":"example-model"})
        for response in [httpx.Response(401,text="private upstream error"),httpx.Response(200,json={"data":[]})]:
            result=check(settings,httpx.MockTransport(lambda request:response))
            self.assertFalse(result["ok"])
            self.assertNotIn("private upstream",str(result))
