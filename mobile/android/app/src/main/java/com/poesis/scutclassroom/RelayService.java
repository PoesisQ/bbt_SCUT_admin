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
    static final String STOP="stop", RETRY="retry", SERVICE_CHANNEL="classroom-listening", ALERT_CHANNEL="classroom-alerts";
    volatile boolean running, loopStarted; ExecutorService worker;
    final Object retrySignal = new Object();
    @Override public void onCreate(){super.onCreate();channels();running=true;worker=Executors.newSingleThreadExecutor();}
    @Override public int onStartCommand(Intent intent,int flags,int startId){if(intent!=null&&STOP.equals(intent.getAction())){Pairing.prefs(this).edit().putBoolean("enabled",false).apply();stopSelf();return START_NOT_STICKY;}startForeground(7,statusNotification("正在连接课堂信箱"));if(!loopStarted){loopStarted=true;worker.submit(this::loop);}synchronized(retrySignal){retrySignal.notifyAll();}return START_STICKY;}

    void loop() {
        int failures=0;
        while(running && Pairing.prefs(this).getBoolean("enabled",false)) {
            long delay;
            try {
                int n=pull(); failures=0;
                Pairing.prefs(this).edit().putLong("last_sync",System.currentTimeMillis()).remove("last_error").apply();
                Pairing.prefs(this).edit().putBoolean("catching_up",n>=RelayPolicy.PAGE_SIZE).apply();
                updateStatus(n>=RelayPolicy.PAGE_SIZE?"已连接 · 正在补齐历史提醒":"已连接课堂信箱 · 正在守候提醒");
                delay=n>=RelayPolicy.PAGE_SIZE?250:5000;
            } catch(Exception e) {
                failures++;
                String message=connectionError(e);
                Pairing.prefs(this).edit().putString("last_error",message).apply();
                updateStatus(message);
                delay=Math.min(60000,3000L*(1L<<Math.min(failures,4)));
            }
            try { synchronized(retrySignal){if(running)retrySignal.wait(delay);} }
            catch(InterruptedException e){break;}
        }
        stopSelf();
    }

    int pull() throws Exception {
        Pairing p=Pairing.load(this);
        if(p==null)throw new Exception("请先扫描电脑上的配对码");
        String cursor=Pairing.prefs(this).getString("cursor","0-0");
        String q="?channel="+URLEncoder.encode(p.channel,"UTF-8")+"&direction=to-phone&after="+URLEncoder.encode(cursor,"UTF-8")+"&limit="+RelayPolicy.PAGE_SIZE;
        HttpURLConnection c=(HttpURLConnection)new URL(p.api("pull")+q).openConnection();
        c.setConnectTimeout(15000); c.setReadTimeout(20000);
        c.setRequestProperty("Authorization","Bearer "+p.auth);
        c.setRequestProperty("Cache-Control","no-store");
        JSONArray messages;
        try {
            int status=c.getResponseCode();
            if(status!=200)throw new RelayHttpException(status);
            try(InputStream in=c.getInputStream()){messages=new JSONObject(read(in)).getJSONArray("messages");}
        } finally { c.disconnect(); }
        for(int i=0;i<messages.length();i++) {
            synchronized (Pairing.class) {
            // A pairing change during a request must never advance the new channel's cursor.
            Pairing current=Pairing.load(this);
            if(current==null || !p.code.equals(current.code))return RelayPolicy.PAGE_SIZE;
            JSONObject item=messages.getJSONObject(i), env;
            try { env=Crypto.open(p,item.getString("wire")); }
            catch(Exception e){throw new InvalidMessageException();}
            if("classroom-alert".equals(env.getString("k")) && History.add(this,env)
                    && RelayPolicy.shouldNotify(env.getLong("ts"),System.currentTimeMillis())) {
                // Denied notification permission must not prevent history synchronization.
                try { showAlert(env); } catch(SecurityException ignored) { }
            }
            cursor=item.getString("cursor");
            // Commit each successfully authenticated/handled item, not the whole page.
            if(!Pairing.prefs(this).edit().putString("cursor",cursor).commit())
                throw new IOException("无法保存手机同步进度");
            }
        }
        return messages.length();
    }

    static class RelayHttpException extends IOException {
        final int status;
        RelayHttpException(int status){this.status=status;}
    }
    static class InvalidMessageException extends Exception { }
    static String connectionError(Exception e) {
        if(e instanceof RelayHttpException) {
            int s=((RelayHttpException)e).status;
            if(s==401 || s==403)return "配对凭据与后台不一致，请重新扫描电脑配对码";
            if(s==404)return "课堂信箱未开通或已停用，请检查电脑手机提醒设置";
            if(s==429)return "后台请求较多，稍后自动重试";
            return "课堂信箱暂时不可用（HTTP "+s+"），会自动重试";
        }
        if(e instanceof InvalidMessageException)return "消息验证失败，请检查手机时间；仍未恢复时重新扫描配对码";
        if(e instanceof UnknownHostException)return "无法解析课堂信箱地址，请检查手机网络或 VPN";
        if(e instanceof javax.net.ssl.SSLException)return "无法建立安全连接，请检查手机日期、网络或 VPN";
        if(e instanceof IOException)return "无法连接课堂信箱，请检查手机网络或 VPN；后台会自动重试";
        return "同步提醒未完成，稍后自动重试";
    }
    void showAlert(JSONObject env)throws Exception{JSONObject d=env.getJSONObject("d");String title=d.optString("label","课堂提醒")+" · "+d.optString("course","当前课程"),message=d.optString("message","请查看课堂信息");Intent open=new Intent(this,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP);PendingIntent pi=PendingIntent.getActivity(this,env.getString("id").hashCode(),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Notification.Builder b=new Notification.Builder(this,ALERT_CHANNEL).setSmallIcon(com.poesis.scutclassroom.R.drawable.ic_notification).setContentTitle(title).setContentText(message).setStyle(new Notification.BigTextStyle().bigText(message)).setContentIntent(pi).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER).setPriority(Notification.PRIORITY_HIGH);getSystemService(NotificationManager.class).notify(env.getString("id").hashCode(),b.build());}
    Notification statusNotification(String text){Intent stop=new Intent(this,RelayService.class).setAction(STOP);PendingIntent sp=PendingIntent.getService(this,0,stop,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);Intent open=new Intent(this,MainActivity.class);PendingIntent op=PendingIntent.getActivity(this,1,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);return new Notification.Builder(this,SERVICE_CHANNEL).setSmallIcon(R.drawable.ic_notification).setContentTitle("SCUT 课堂提醒").setContentText(text).setContentIntent(op).setOngoing(true).addAction(new Notification.Action.Builder(null,"暂停",sp).build()).build();}
    void updateStatus(String t){getSystemService(NotificationManager.class).notify(7,statusNotification(t));}
    void channels(){NotificationManager n=getSystemService(NotificationManager.class);n.createNotificationChannel(new NotificationChannel(SERVICE_CHANNEL,"课堂监听状态",NotificationManager.IMPORTANCE_LOW));NotificationChannel alerts=new NotificationChannel(ALERT_CHANNEL,"课堂重要提醒",NotificationManager.IMPORTANCE_HIGH);alerts.enableVibration(true);n.createNotificationChannel(alerts);}
    static String read(InputStream in)throws Exception{ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] b=new byte[4096];int n,total=0;while((n=in.read(b))>0){total+=n;if(total>RelayPolicy.MAX_RESPONSE_BYTES)throw new IOException("response too large");out.write(b,0,n);}return new String(out.toByteArray(),StandardCharsets.UTF_8);}
    @Override public void onDestroy(){running=false;if(worker!=null)worker.shutdownNow();stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy();}
    @Override public android.os.IBinder onBind(Intent i){return null;}
}
