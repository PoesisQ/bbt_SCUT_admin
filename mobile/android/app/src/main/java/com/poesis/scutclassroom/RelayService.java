package com.poesis.scutclassroom;

import android.app.*;
import android.content.*;
import android.os.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.*;

public class RelayService extends Service {
    static final String STOP="stop", SERVICE_CHANNEL="classroom-listening", ALERT_CHANNEL="classroom-alerts";
    volatile boolean running, loopStarted; ExecutorService worker;
    @Override public void onCreate(){super.onCreate();channels();running=true;worker=Executors.newSingleThreadExecutor();}
    @Override public int onStartCommand(Intent intent,int flags,int startId){if(intent!=null&&STOP.equals(intent.getAction())){Pairing.prefs(this).edit().putBoolean("enabled",false).apply();stopSelf();return START_NOT_STICKY;}startForeground(7,statusNotification("正在守候课堂提醒"));if(!loopStarted){loopStarted=true;worker.submit(this::loop);}return START_STICKY;}
    void loop(){int failures=0;while(running&&Pairing.prefs(this).getBoolean("enabled",false)){try{int n=pull();failures=0;Pairing.prefs(this).edit().putLong("last_sync",System.currentTimeMillis()).remove("last_error").apply();updateStatus(n>0?"刚刚收到课堂提醒":"正在守候课堂提醒");Thread.sleep(n>=100?250:5000);}catch(Exception e){failures++;Pairing.prefs(this).edit().putString("last_error",e.getClass().getSimpleName()).apply();updateStatus("连接暂时中断，正在重试");try{Thread.sleep(Math.min(60000,3000L*(1L<<Math.min(failures,4))));}catch(InterruptedException ignored){break;}}}stopSelf();}
    int pull()throws Exception{Pairing p=Pairing.load(this);if(p==null)throw new Exception("not paired");String cursor=Pairing.prefs(this).getString("cursor","0-0");String q="?channel="+URLEncoder.encode(p.channel,"UTF-8")+"&direction=to-phone&after="+URLEncoder.encode(cursor,"UTF-8")+"&limit=100";HttpURLConnection c=(HttpURLConnection)new URL(p.api("pull")+q).openConnection();c.setConnectTimeout(12000);c.setReadTimeout(12000);c.setRequestProperty("Authorization","Bearer "+p.auth);c.setRequestProperty("Cache-Control","no-store");int status=c.getResponseCode();if(status!=200)throw new Exception("HTTP "+status);String raw=read(c.getInputStream());JSONObject body=new JSONObject(raw);JSONArray messages=body.getJSONArray("messages");for(int i=0;i<messages.length();i++){JSONObject item=messages.getJSONObject(i);JSONObject env=Crypto.open(p,item.getString("wire"));if("classroom-alert".equals(env.getString("k"))&&History.add(this,env))showAlert(env);cursor=item.getString("cursor");}Pairing.prefs(this).edit().putString("cursor",cursor).apply();return messages.length();}
    void showAlert(JSONObject env)throws Exception{JSONObject d=env.getJSONObject("d");String title=d.optString("label","课堂提醒")+" · "+d.optString("course","当前课程"),message=d.optString("message","请查看课堂信息");Intent open=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);PendingIntent pi=PendingIntent.getActivity(this,env.getString("id").hashCode(),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification.Builder b=new Notification.Builder(this,ALERT_CHANNEL).setSmallIcon(com.poesis.scutclassroom.R.drawable.ic_notification).setContentTitle(title).setContentText(message).setStyle(new Notification.BigTextStyle().bigText(message)).setContentIntent(pi).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER).setPriority(Notification.PRIORITY_HIGH);getSystemService(NotificationManager.class).notify(env.getString("id").hashCode(),b.build());}
    Notification statusNotification(String text){Intent stop=new Intent(this,RelayService.class).setAction(STOP);PendingIntent sp=PendingIntent.getService(this,0,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Intent open=new Intent(this,MainActivity.class);PendingIntent op=PendingIntent.getActivity(this,1,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);return new Notification.Builder(this,SERVICE_CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("SCUT 课堂提醒").setContentText(text).setContentIntent(op).setOngoing(true).addAction(new Notification.Action.Builder(null,"暂停",sp).build()).build();}
    void updateStatus(String t){getSystemService(NotificationManager.class).notify(7,statusNotification(t));}
    void channels(){NotificationManager n=getSystemService(NotificationManager.class);n.createNotificationChannel(new NotificationChannel(SERVICE_CHANNEL,"课堂监听状态",NotificationManager.IMPORTANCE_LOW));NotificationChannel alerts=new NotificationChannel(ALERT_CHANNEL,"课堂重要提醒",NotificationManager.IMPORTANCE_HIGH);alerts.enableVibration(true);n.createNotificationChannel(alerts);}
    static String read(InputStream in)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n,total=0;while((n=in.read(b))>0){total+=n;if(total>256*1024)throw new Exception("response too large");out.write(b,0,n);}return new String(out.toByteArray(),StandardCharsets.UTF_8);}
    @Override public void onDestroy(){running=false;if(worker!=null)worker.shutdownNow();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public android.os.IBinder onBind(Intent i){return null;}
}
