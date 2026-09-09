import unittest
from assistant_service.records import annotate, contains


def record(sid, begin, end, **changes):
    return dict(id=sid, course_id="1", sub_id="2", mode="replay", time_basis="video", status="complete",
                created_at=int(sid), analysis_status="complete", segments=[{"start":begin,"end":end,"text":"句子"}], **changes)


class CoverageTests(unittest.TestCase):
    def test_full_record_covers_partial_and_equal_coverage_keeps_newer(self):
        rows=annotate([record("1",30,60),record("2",0,100),record("3",0,100)],lambda sid:[])
        self.assertEqual([r["superseded_by"] for r in rows],["3","3",None])

    def test_later_shorter_result_does_not_replace_full_lesson(self):
        rows=annotate([record("1",0,100),record("2",30,60)],lambda sid:[])
        self.assertEqual([r["superseded_by"] for r in rows],[None,"1"])

    def test_source_timing_and_processing_boundaries_are_preserved(self):
        original=record("1",0,100)
        for changes in [dict(mode="subtitle"),dict(time_basis="capture"),dict(status="failed"),dict(status="transcribing")]:
            candidate={**record("2",0,120),**changes}
            self.assertIsNone(annotate([original,candidate],lambda sid:[])[0]["superseded_by"])

    def test_gap_in_audio_is_not_a_full_coverage(self):
        def inputs(sid):
            return [{"start":0,"duration":40},{"start":60,"duration":40}] if sid=="2" else [{"start":30,"duration":40}]
        rows=annotate([record("1",30,70),record("2",0,100)],inputs)
        self.assertTrue(all(r["superseded_by"] is None for r in rows))
        self.assertFalse(contains([[0,40],[60,100]],[[30,70]]))

    def test_multiple_capture_relative_recordings_never_cover_each_other(self):
        rows=annotate([{**record("1",0,30),"time_basis":"capture"},{**record("2",0,100),"time_basis":"capture"}],lambda sid:[])
        self.assertTrue(all(r["superseded_by"] is None for r in rows))
