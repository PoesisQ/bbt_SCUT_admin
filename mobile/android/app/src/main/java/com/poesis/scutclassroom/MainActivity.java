package com.poesis.scutclassroom;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.text.InputType;
import android.view.*;
import android.widget.*;
import com.google.zxing.integration.android.IntentIntegrator;
import com.google.zxing.integration.android.IntentResult;
import org.json.*;
import java.text.SimpleDateFormat;
import java.util.*;

public class MainActivity extends Activity {
    LinearLayout root, history; TextView state; EditText code; Switch enabled;
    int blue=Color.rgb(44,92,210), ink=Color.rgb(28,32,43), muted=Color.rgb(123,129,148);
    @Override public void onCreate(Bundle b){super.onCreate(b);if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},40);render();}
    void render(){ScrollView scroll=new ScrollView(this);root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setPadding(dp(24),dp(42),dp(24),dp(40));root.setBackgroundColor(Color.rgb(246,247,251));scroll.addView(root);setContentView(scroll);
        TextView mark=text("SCUT · STAY INFORMED",11,blue);mark.setLetterSpacing(.18f);root.addView(mark);
        TextView title=text("离开电脑，\n也不会错过课堂。",31,ink);title.setTypeface(Typeface.DEFAULT,Typeface.BOLD);title.setPadding(0,dp(14),0,dp(9));root.addView(title);
        root.addView(text("点名、扫码、提问、课堂测试、作业与课程安排，都会以系统通知送到这里。",14,muted));
        LinearLayout status=card();state=text("正在读取状态…",14,ink);enabled=new Switch(this);enabled.setText("保持后台监听");enabled.setTextColor(ink);enabled.setTextSize(14);status.addView(state);status.addView(enabled,new LinearLayout.LayoutParams(-1,-2));root.addView(status,margin(0,24,0,14));
        Pairing pairing=Pairing.load(this);boolean on=pairing!=null&&Pairing.prefs(this).getBoolean("enabled",false);enabled.setEnabled(pairing!=null);enabled.setChecked(on);state.setText(pairing==null?"尚未与电脑配对":"手机已配对 · "+(on?"后台监听中":"提醒已暂停"));enabled.setOnCheckedChangeListener((v,w)->{Pairing.prefs(this).edit().putBoolean("enabled",w).apply();if(w)startForegroundService(new Intent(this,RelayService.class));else startService(new Intent(this,RelayService.class).setAction(RelayService.STOP));state.setText(w?"手机已配对 · 后台监听中":"手机已配对 · 提醒已暂停");});
        LinearLayout pair=card();TextView pairTitle=text(pairing==null?"连接电脑":"重新配对",19,ink);pairTitle.setTypeface(Typeface.DEFAULT,Typeface.BOLD);pair.addView(pairTitle);pair.addView(text("在电脑的“偏好设置 → 提醒与存储”生成二维码。网站只中转密文，课程内容在手机本地解密。",13,muted),margin(0,8,0,16));
        LinearLayout buttons=new LinearLayout(this);buttons.setOrientation(LinearLayout.HORIZONTAL);Button scan=button("扫描二维码",true),paste=button("从剪贴板粘贴",false);buttons.addView(scan,new LinearLayout.LayoutParams(0,dp(48),1));LinearLayout.LayoutParams p2=new LinearLayout.LayoutParams(0,dp(48),1);p2.setMarginStart(dp(10));buttons.addView(paste,p2);pair.addView(buttons);code=new EditText(this);code.setHint("也可以粘贴 SCUT1. 开头的配对码");code.setTextSize(12);code.setSingleLine(false);code.setMinLines(2);code.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);pair.addView(code,margin(0,14,0,0));Button save=button("保存并开始监听",true);pair.addView(save,margin(0,10,0,0));root.addView(pair,margin(0,0,0,24));
        scan.setOnClickListener(v->new IntentIntegrator(this).setPrompt("扫描电脑上的课堂提醒配对码").setBeepEnabled(false).setOrientationLocked(false).initiateScan());paste.setOnClickListener(v->{ClipboardManager c=(ClipboardManager)getSystemService(CLIPBOARD_SERVICE);if(c.hasPrimaryClip())code.setText(c.getPrimaryClip().getItemAt(0).coerceToText(this));});save.setOnClickListener(v->pair(String.valueOf(code.getText())));
        TextView recent=text("最近提醒",20,ink);recent.setTypeface(Typeface.DEFAULT,Typeface.BOLD);root.addView(recent);history=new LinearLayout(this);history.setOrientation(LinearLayout.VERTICAL);root.addView(history);renderHistory();
    }
    void pair(String raw){try{Pairing p=new Pairing(raw);p.save(this);startForegroundService(new Intent(this,RelayService.class));Toast.makeText(this,"配对成功，后台监听已开启",Toast.LENGTH_LONG).show();render();}catch(Exception e){Toast.makeText(this,e.getMessage(),Toast.LENGTH_LONG).show();}}
    void renderHistory(){history.removeAllViews();JSONArray rows=History.list(this);if(rows.length()==0){history.addView(text("收到的重要信息会按时间显示在这里。",13,muted),margin(0,14,0,0));return;}for(int i=0;i<Math.min(rows.length(),30);i++){try{JSONObject env=rows.getJSONObject(i),d=env.getJSONObject("d");LinearLayout item=card();TextView label=text(d.optString("label","课堂提醒")+"  ·  "+d.optString("course","当前课程"),12,blue);label.setTypeface(Typeface.DEFAULT,Typeface.BOLD);item.addView(label);TextView msg=text(d.optString("message"),16,ink);msg.setTypeface(Typeface.DEFAULT,Typeface.BOLD);item.addView(msg,margin(0,8,0,7));String detail=details(d.optJSONObject("details"));if(!detail.isEmpty())item.addView(text(detail,13,muted));item.addView(text(new SimpleDateFormat("MM-dd HH:mm",Locale.CHINA).format(new Date(env.getLong("ts"))),11,muted),margin(0,11,0,0));history.addView(item,margin(0,12,0,0));}catch(Exception ignored){}}}
    String details(JSONObject d){if(d==null)return "";StringBuilder s=new StringBuilder();for(String k:new String[]{"action","deadline","submission","requirements","grading"}){String v=d.optString(k);if(!v.isEmpty()){if(s.length()>0)s.append("\n");s.append(v);}}return s.toString();}
    @Override protected void onActivityResult(int request,int result,Intent data){IntentResult r=IntentIntegrator.parseActivityResult(request,result,data);if(r!=null){if(r.getContents()!=null)pair(r.getContents());return;}super.onActivityResult(request,result,data);}
    TextView text(String value,int size,int color){TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(color);v.setLineSpacing(0,1.12f);return v;}
    LinearLayout card(){LinearLayout v=new LinearLayout(this);v.setOrientation(LinearLayout.VERTICAL);v.setPadding(dp(20),dp(20),dp(20),dp(20));GradientDrawable g=new GradientDrawable();g.setColor(Color.WHITE);g.setCornerRadius(dp(22));g.setStroke(dp(1),Color.rgb(231,233,240));v.setBackground(g);v.setElevation(dp(2));return v;}
    Button button(String text,boolean primary){Button b=new Button(this);b.setText(text);b.setTextSize(12);b.setAllCaps(false);b.setTextColor(primary?Color.WHITE:ink);GradientDrawable g=new GradientDrawable();g.setColor(primary?blue:Color.rgb(241,243,248));g.setCornerRadius(dp(14));b.setBackground(g);return b;}
    LinearLayout.LayoutParams margin(int l,int t,int r,int b){LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(dp(l),dp(t),dp(r),dp(b));return p;}
    int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
}
