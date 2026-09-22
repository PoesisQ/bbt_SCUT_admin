package com.poesis.scutclassroom;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;

final class Pairing {
    static final String PREFIX = "SCUT1.";
    final String url, appId, channel, auth, key, code;
    Pairing(String code) throws Exception {
        if (code == null || !code.trim().startsWith(PREFIX)) throw new Exception("配对码应以 SCUT1. 开头");
        this.code = code.trim();
        JSONObject j = new JSONObject(new String(Base64.decode(this.code.substring(PREFIX.length()), Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING), StandardCharsets.UTF_8));
        url = j.getString("u"); appId = j.getString("i"); channel = j.getString("c"); auth = j.getString("a"); key = j.getString("k");
        if (!url.startsWith("https://") || !appId.matches("[a-z0-9][a-z0-9-]{0,31}") || !channel.matches("[A-Za-z0-9_-]{16,64}")) throw new Exception("配对信息格式不正确");
        if (decode(auth).length != 32 || decode(key).length != 32) throw new Exception("配对密钥长度不正确");
    }
    String api(String action) { return url.replaceAll("/+$", "") + "/api/apps/" + appId + "/" + action; }
    static byte[] decode(String value) { return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING); }
    static SharedPreferences prefs(Context c) { return c.getSharedPreferences("classroom-private", Context.MODE_PRIVATE); }
    static Pairing load(Context c) { try { String code=prefs(c).getString("pairing", ""); return code.isEmpty()?null:new Pairing(code); } catch(Exception e) { return null; } }
    void save(Context c) { prefs(c).edit().putString("pairing", code).putBoolean("enabled", true).putString("cursor", "0-0").apply(); }
}
