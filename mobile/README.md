# SCUT 课堂提醒 Android App

手机 App 通过 `https://ironegg.vercel.app/api/apps/scut-classroom/*` 接收端到端加密消息。它使用独立的 app-id、channel、Bearer 与 AES 密钥，不读取 DSH Remote 的配对信息。

电脑端在“偏好设置 → 提醒与存储”生成一次配对二维码。手机扫码后开启 `remoteMessaging` 前台服务，每 5 秒拉取课堂事件；锁屏或离开 App 后仍显示系统通知。通知正文只在手机本地解密，中继只保存 `v2` 密文。

构建需要 JDK 17、Android SDK 35 与 Gradle 8.7：

```bash
cd mobile/android
gradle --no-daemon assembleDebug
```

APK 位于 `app/build/outputs/apk/debug/app-debug.apk`。当前是个人使用的 debug 签名构建；升级时保留相同签名，否则需要先卸载旧版本并重新配对。
