package com.poesis.scutclassroom;

import android.content.Context;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;

final class History {
    static synchronized boolean add(Context c, JSONObject env) throws Exception {
        String id=env.getString("id"); JSONArray old=list(c); Set<String> ids=new HashSet<>();
        for(int i=0;i<old.length();i++) ids.add(old.getJSONObject(i).optString("id"));
        if(ids.contains(id)) return false;
        JSONArray fresh=new JSONArray(); fresh.put(env); for(int i=0;i<Math.min(old.length(),199);i++) fresh.put(old.getJSONObject(i));
        Pairing.prefs(c).edit().putString("history",fresh.toString()).apply(); return true;
    }
    static JSONArray list(Context c){try{return new JSONArray(Pairing.prefs(c).getString("history","[]"));}catch(Exception e){return new JSONArray();}}
}
