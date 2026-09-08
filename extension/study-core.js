(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.ScutStudy = api;
})(globalThis, function() {
  "use strict";
  function mediaSources(info, origin) {
    const result = [];
    const seen = new Set();
    function add(value, label, kind, depth = 0) {
      if (!value || depth > 5) return;
      if (typeof value === "object") {
        for (const [key, item] of Object.entries(value)) add(item, `${label} ${key}`, kind, depth + 1);
        return;
      }
      if (typeof value !== "string") return;
      try {
        const url = new URL(value, origin);
        if (!/^https?:$/.test(url.protocol) || url.username || url.password || !/\.(m3u8|mp4|flv|m4a|mp3)(?:$|[?#])/i.test(url.href)) return;
        if (seen.has(url.href)) return;
        seen.add(url.href);
        result.push({url: url.href, label: label.trim(), kind, format: url.pathname.split(".").pop(),
                     audio: /audio|m4a|mp3/.test(label + url.pathname)});
      } catch { /* Malformed site data is not an executable source. */ }
    }
    add(info.live_url?.output, "教师直播", "live");
    add(info.content?.save_playback, "课堂回放", "replay");
    add(info.playurl, "回放", "replay");
    for (const item of Object.values(info.video_list || {})) {
      if (String(item.type) === "3") add(item.preview_url, "教师机位", "replay");
    }
    return result.sort((a,b) => Number(b.audio) - Number(a.audio) ||
      Number(b.format === "mp4") - Number(a.format === "mp4") || Number(b.format === "m3u8") - Number(a.format === "m3u8"));
  }
  function lesson(info, context) {
    const url = new URL(context.url);
    return {course_id: String(context.courseId), sub_id: String(context.subId),
      course_title: info.course_title || "课程", title: info.sub_title || context.subId,
      page_url: url.href, start_at: Number(info.start_at) || 0,
      time_basis: String(info.sub_status) === "1" ? "capture" : "video"};
  }
  function catalogue(body) {
    const rows = body?.result?.data || body?.data || [];
    if (!Array.isArray(rows)) return [];
    return rows.filter(s => /^\d+$/.test(String(s.sub_id ?? s.id ?? ""))).map((s,index) => ({
      sub_id: String(s.sub_id ?? s.id), title: s.sub_title || s.title || `课时 ${index + 1}`,
      start_at: Number(s.start_at) || 0, status: String(s.sub_status ?? s.status ?? ""),
    })).sort((a,b) => a.start_at - b.start_at || Number(a.sub_id) - Number(b.sub_id));
  }
  function replayEligible(item) {
    // Site states: 1 live, 2 scheduled, 3 generating replay, 5 unavailable, 6 replay, 9 ended without replay.
    return !["1","2","3","5","9"].includes(String(item.status));
  }
  function wav(pcm, sampleRate=16000) {
    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const data = new DataView(buffer);
    function string(at, value) { for (let i=0;i<value.length;i++) data.setUint8(at+i,value.charCodeAt(i)); }
    string(0,"RIFF"); data.setUint32(4,36+pcm.length*2,true); string(8,"WAVE"); string(12,"fmt ");
    data.setUint32(16,16,true); data.setUint16(20,1,true); data.setUint16(22,1,true);
    data.setUint32(24,sampleRate,true); data.setUint32(28,sampleRate*2,true); data.setUint16(32,2,true); data.setUint16(34,16,true);
    string(36,"data"); data.setUint32(40,pcm.length*2,true);
    for (let i=0;i<pcm.length;i++) data.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,pcm[i]))*(pcm[i]<0?32768:32767)),true);
    return buffer;
  }
  function time(seconds) { const n=Math.max(0,Math.floor(seconds||0));return [Math.floor(n/3600),Math.floor(n%3600/60),n%60].map(x=>String(x).padStart(2,"0")).join(":"); }
  return {mediaSources, lesson, catalogue, replayEligible, wav, time};
});
