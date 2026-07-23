import json
import tempfile
import unittest
from pathlib import Path

import subtitle
from browser import _extract_list
from main import parse_course_url
from subtitle import format_time, json_to_srt, json_to_text, save_subtitle


class CourseUrlTests(unittest.TestCase):
    def test_standard_course_url(self):
        course_id, sub_id = parse_course_url(
            "https://video.jw.scut.edu.cn/livingroom"
            "?course_id=64762&sub_id=554146&tenant_code=21"
        )
        self.assertEqual(course_id, "64762")
        self.assertEqual(sub_id, "554146")

    def test_invalid_url(self):
        self.assertEqual(parse_course_url("https://example.com/?sub_id=1"), (None, None))
        self.assertEqual(
            parse_course_url("https://video.jw.scut.edu.cn/livingroom?course_id=1"),
            (None, None),
        )


class SubtitleTests(unittest.TestCase):
    def test_nested_subtitle_extraction(self):
        items = [{"BeginSec": 1, "EndSec": 2, "Text": "你好"}]
        self.assertEqual(_extract_list({"list": [{"all_content": items}]}), items)

    def test_format_conversion(self):
        items = [
            {"BeginSec": 1, "EndSec": 2, "Text": " 第一条 "},
            {"BeginSec": 5.25, "Text": "第二条"},
        ]
        srt = json_to_srt(items)
        self.assertIn("1\n00:00:01,000 --> 00:00:02,000\n第一条", srt)
        self.assertIn("2\n00:00:05,250 --> 00:00:10,250\n第二条", srt)
        self.assertEqual(json_to_text(items), "第一条\n第二条")
        self.assertEqual(format_time(3661.5), "01:01:01,500")

    def test_save_creates_three_readable_files(self):
        old_output = subtitle.OUTPUT_DIR
        items = [{"BeginSec": 0, "EndSec": 1, "Text": "测试字幕"}]
        with tempfile.TemporaryDirectory() as temp_dir:
            output_dir = Path(temp_dir) / "output"
            subtitle.OUTPUT_DIR = output_dir
            try:
                json_path, srt_path, txt_path = save_subtitle(items, "554146")
            finally:
                subtitle.OUTPUT_DIR = old_output

            self.assertEqual(json.loads(json_path.read_text(encoding="utf-8")), items)
            self.assertIn("测试字幕", srt_path.read_text(encoding="utf-8"))
            self.assertEqual(txt_path.read_text(encoding="utf-8"), "测试字幕")
            self.assertTrue(json_path.resolve().is_relative_to((output_dir / "json").resolve()))
            self.assertTrue(srt_path.resolve().is_relative_to((output_dir / "srt").resolve()))
            self.assertTrue(txt_path.resolve().is_relative_to((output_dir / "txt").resolve()))


class ExtensionManifestTests(unittest.TestCase):
    def test_manifest_permissions_are_scoped(self):
        manifest_path = Path(__file__).parents[1] / "extension" / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["manifest_version"], 3)
        self.assertNotIn("<all_urls>", manifest.get("host_permissions", []))
        self.assertEqual(
            manifest["host_permissions"],
            ["https://video.jw.scut.edu.cn/*"],
        )


if __name__ == "__main__":
    unittest.main()
