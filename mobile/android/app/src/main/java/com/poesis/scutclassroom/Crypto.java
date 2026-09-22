package com.poesis.scutclassroom;

import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class Crypto {
    static JSONObject open(Pairing p, String wire) throws Exception {
        String[] x=wire.split("\\."); if(x.length!=4 || !"v2".equals(x[0])) throw new Exception("密文格式错误");
        String id=x[1], direction="to-phone";
        byte[] salt=("dsh-remote:"+p.channel).getBytes(StandardCharsets.UTF_8), info=("dsh-remote/v2:"+direction).getBytes(StandardCharsets.UTF_8);
        byte[] key=hkdf(Pairing.decode(p.key),salt,info), iv=decode(x[2]), blob=decode(x[3]);
        if(iv.length!=12 || blob.length<17) throw new Exception("密文长度错误");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));
        cipher.updateAAD(("dsh-remote/v2|"+p.channel+"|"+direction+"|"+id).getBytes(StandardCharsets.UTF_8));
        JSONObject env=new JSONObject(new String(cipher.doFinal(blob),StandardCharsets.UTF_8));
        long age=System.currentTimeMillis()-env.getLong("ts");
        if(env.getInt("v")!=2 || !id.equals(env.getString("id")) || age>7L*24*3600*1000 || age < -5L*60*1000) throw new Exception("消息校验失败");
        return env;
    }
    static byte[] hkdf(byte[] input,byte[] salt,byte[] info)throws Exception{Mac m=Mac.getInstance("HmacSHA256");m.init(new SecretKeySpec(salt,"HmacSHA256"));byte[] prk=m.doFinal(input);m.init(new SecretKeySpec(prk,"HmacSHA256"));m.update(info);m.update((byte)1);byte[] out=m.doFinal();byte[] key=new byte[32];System.arraycopy(out,0,key,0,32);return key;}
    static byte[] decode(String v){return Base64.decode(v,Base64.URL_SAFE|Base64.NO_WRAP|Base64.NO_PADDING);}
}
