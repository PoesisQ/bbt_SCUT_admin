package com.poesis.scutclassroom;
import android.content.*;
public class BootReceiver extends BroadcastReceiver { @Override public void onReceive(Context c,Intent i){if(Pairing.prefs(c).getBoolean("enabled",false)&&Pairing.load(c)!=null)c.startForegroundService(new Intent(c,RelayService.class));} }
