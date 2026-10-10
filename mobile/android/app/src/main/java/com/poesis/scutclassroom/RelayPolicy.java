package com.poesis.scutclassroom;

/** Policies applied only AFTER AES-GCM authentication succeeds. */
final class RelayPolicy {
    static final int PAGE_SIZE = 10;
    static final int MAX_RESPONSE_BYTES = 1024 * 1024;

    static void validate(int version, String outerId, String innerId, long timestamp, long now) throws Exception {
        if (version != 2 || !outerId.equals(innerId) || timestamp <= 0 || timestamp - now > 5L * 60 * 1000)
            throw new Exception("消息校验失败，请检查手机时间与配对信息");
        // Authenticated historical messages must not trap the cursor forever.
        // Keep them in history; only recent messages produce system notifications.
    }

    static boolean shouldNotify(long timestamp, long now) {
        return now - timestamp <= 15L * 60 * 1000;
    }
}
