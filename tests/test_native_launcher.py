import json
import os
import struct
import subprocess
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(os.name == "nt", "Windows native launcher")
class NativeLauncherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.tmp.name)
        cls.exe = cls.root / "native.exe"
        source = Path(__file__).resolve().parents[1] / "scripts/NativeLauncher.cs"
        compiler = Path(os.environ["SystemRoot"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
        if not compiler.is_file():
            cls.tmp.cleanup()
            raise unittest.SkipTest(".NET Framework compiler not available")
        subprocess.run([str(compiler), "/nologo", "/target:exe", "/reference:System.Web.Extensions.dll",
                        "/out:" + str(cls.exe), str(source)], check=True, capture_output=True)
        cls.origin = "chrome-extension://" + "a" * 32 + "/"
        (cls.root / "native-launcher-config.json").write_text(json.dumps({"root": str(cls.root), "origins": [cls.origin]}), encoding="utf-8")

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def request(self, body, origin=None, length=None):
        raw = json.dumps(body).encode()
        result = subprocess.run([str(self.exe), origin or self.origin],
            input=struct.pack("<I", len(raw) if length is None else length) + raw,
            capture_output=True, timeout=10, check=True)
        size = struct.unpack("<I", result.stdout[:4])[0]
        self.assertEqual(size, len(result.stdout) - 4)
        return json.loads(result.stdout[4:])

    def test_unregistered_origin_cannot_start_processes_or_read_tokens(self):
        result = self.request({"action": "start"}, "chrome-extension://" + "b" * 32 + "/")
        self.assertFalse(result["ok"])
        self.assertNotIn("token", result)

    def test_unknown_commands_and_oversized_frames_are_rejected(self):
        self.assertFalse(self.request({"action": "execute", "command": "arbitrary"})["ok"])
        self.assertFalse(self.request({"action": "start"}, length=5000)["ok"])
