# SCUT 课堂提醒 Android App

手机 App 通过 `https://ironegg.vercel.app/api/apps/scut-classroom/*` 接收端到端加密消息。它使用独立的 app-id、channel、Bearer 与 AES 密钥，不读取 DSH Remote 的配对信息。

电脑端在“偏好设置 → 提醒与存储”生成一次配对二维码。手机扫码后开启 `remoteMessaging` 前台服务，每 5 秒拉取课堂事件；锁屏或离开 App 后仍显示系统通知。通知正文只在手机本地解密，中继只保存 `v2` 密文。

构建需要 JDK 17、Android SDK 35 与 Gradle 8.7：

```bash
cd mobile/android
gradle --no-daemon assembleDebug
```

APK 位于 `app/build/outputs/apk/debug/app-debug.apk`。当前是个人使用的 debug 签名构建；升级时保留相同签名，否则需要先卸载旧版本并重新配对。

0.10.7 修复了离线超过 7 天后，旧消息一直阻塞新提醒的问题。重新连接会先补齐历史，只有最近 15 分钟的消息弹出系统通知。直接覆盖安装，原配对、同步进度和本机记录都会保留。

App 的“已配对”表示密钥已保存，“已连接”表示最近成功读取了远程信箱。电脑直播转写正常不代表手机网络也能访问中继。网络或 VPN 无法访问该地址时会自动重试，也可以点击“立即重试连接”；凭据、消息验证和后台错误会显示对应原因。不要通过卸载 App 来尝试重连。

电脑发送端会使用 Windows 配置的 HTTPS 代理访问远程信箱。本地课程服务仍通过 localhost 连接。
