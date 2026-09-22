import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from assistant_service.mobile import MobileNotifier, make_pairing, pairing_code, registry_entry, seal, unb64
from assistant_service.settings import Settings
from assistant_service.store import Store


class MobileProtocolTests(unittest.TestCase):
    def test_pairing_contains_independent_credentials_and_wire_round_trips(self):
        pairing = make_pairing()
        self.assertTrue(pairing_code(pairing).startswith("SCUT1."))
        self.assertEqual(len(unb64(pairing["auth_token"])), 32)
        self.assertEqual(len(unb64(pairing["e2e_key"])), 32)
        self.assertNotIn(pairing["auth_token"], json.dumps(registry_entry(pairing)))
        mid, wire = seal(pairing, "classroom-alert", {"message": "请扫码签到"}, message_id="messageid12345678", now=100)
        _, inner, iv, blob = wire.split(".")
        key = HKDF(algorithm=hashes.SHA256(), length=32,
                   salt=("dsh-remote:" + pairing["channel"]).encode(),
                   info=b"dsh-remote/v2:to-phone").derive(unb64(pairing["e2e_key"]))
        raw = AESGCM(key).decrypt(unb64(iv), unb64(blob),
            f"dsh-remote/v2|{pairing['channel']}|to-phone|{inner}".encode())
        self.assertEqual(json.loads(raw)["d"]["message"], "请扫码签到")
        self.assertEqual(mid, inner)

    def test_only_confirmed_live_events_are_queued_durably_and_deduplicated(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp))
            store = Store(settings.root)
            pairing = make_pairing(); pairing["enabled_at"] = 0
            settings.data["mobile_notifications_enabled"] = True
            session = store.create({"mode": "live", "course_id": "1", "sub_id": "2", "course_title": "操作系统", "title": "第2-4节", "analysis": False})
            events = [{"id": "confirmed", "category": "attendance", "label": "点名／签到", "priority": "urgent",
                       "message": "现在开始点名", "evidence": "现在开始点名", "source": "deepseek", "start": 30},
                      {"id": "rule", "category": "quiz", "message": "疑似测验", "evidence": "疑似测验", "source": "local_rule", "start": 50}]
            store.update(session["id"], events=events)
            with patch.object(settings, "mobile_pairing", return_value=pairing):
                notifier = MobileNotifier(settings, store)
                notifier.scan(); notifier.scan()
                self.assertEqual(len(notifier.state["outbox"]), 1)
                reopened = MobileNotifier(settings, store)
                reopened.scan()
                self.assertEqual(len(reopened.state["outbox"]), 1)
            store.db.close()

    def test_pairing_during_a_live_class_only_sends_recent_events(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp))
            store = Store(settings.root)
            pairing = make_pairing()
            pairing["enabled_at"] = time.time()
            settings.data["mobile_notifications_enabled"] = True
            session = store.create({"mode": "live", "course_id": "1", "sub_id": "2",
                                    "course_title": "操作系统", "title": "第2-4节", "analysis": False})
            start_at = pairing["enabled_at"] - 3600
            store.update(session["id"], created_at=start_at, start_at=start_at, events=[
                {"id": "old", "category": "attendance", "label": "点名", "message": "之前的点名",
                 "evidence": "之前的点名", "source": "deepseek", "start": 60},
                {"id": "recent", "category": "assignment", "label": "作业", "message": "刚布置的作业",
                 "evidence": "刚布置的作业", "source": "deepseek", "start": 3500},
            ])
            with patch.object(settings, "mobile_pairing", return_value=pairing):
                notifier = MobileNotifier(settings, store)
                notifier.scan()
                self.assertEqual(len(notifier.state["outbox"]), 1)
                self.assertEqual(len(notifier.state["sent"]), 1)
            store.db.close()

    def test_outbox_is_removed_only_after_authenticated_relay_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            settings = Settings(Path(tmp)); store = Store(settings.root); pairing = make_pairing()
            settings.data["mobile_notifications_enabled"] = True
            seen = []
            def relay(request):
                seen.append(request)
                self.assertEqual(request.headers["authorization"], "Bearer " + pairing["auth_token"])
                self.assertTrue(request.url.path.endswith("/api/apps/scut-classroom/push"))
                return httpx.Response(201, json={"ok": True, "cursor": "1-0"})
            with patch.object(settings, "mobile_pairing", return_value=pairing):
                notifier = MobileNotifier(settings, store, transport=httpx.MockTransport(relay))
                notifier.queue("classroom-alert", {"message": "测试"}, "once")
                notifier.flush()
                self.assertEqual(notifier.state["outbox"], [])
                self.assertEqual(len(seen), 1)
            store.db.close()
