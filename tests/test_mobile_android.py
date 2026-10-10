import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


class AndroidRelayPolicyTests(unittest.TestCase):
    def test_historical_messages_do_not_block_fresh_notifications(self):
        java_root = Path(os.environ.get("JAVA_HOME", "")) / "bin"
        suffix = ".exe" if os.name == "nt" else ""
        javac = str(java_root / ("javac" + suffix)) if (java_root / ("javac" + suffix)).is_file() else shutil.which("javac")
        java = str(java_root / ("java" + suffix)) if (java_root / ("java" + suffix)).is_file() else shutil.which("java")
        if not javac or not java:
            self.skipTest("Android relay policy regression requires a JDK")
        root = Path(__file__).resolve().parents[1] / "mobile/android"
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([javac, "-encoding", "UTF-8", "-d", tmp,
                            str(root / "app/src/main/java/com/poesis/scutclassroom/RelayPolicy.java"),
                            str(root / "policy-tests/RelayPolicyTest.java")], check=True, capture_output=True)
            subprocess.run([java, "-cp", tmp, "com.poesis.scutclassroom.RelayPolicyTest"],
                           check=True, capture_output=True)
