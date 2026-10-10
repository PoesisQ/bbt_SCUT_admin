package com.poesis.scutclassroom;

public final class RelayPolicyTest {
    static final long NOW = 1791600000000L;
    static void check(boolean value) { if (!value) throw new AssertionError(); }
    static void rejected(int version, String id, long timestamp) throws Exception {
        try { RelayPolicy.validate(version,"outer",id,timestamp,NOW); }
        catch (Exception expected) { return; }
        throw new AssertionError("invalid envelope accepted");
    }
    public static void main(String[] args) throws Exception {
        // Reconnection after weeks offline must pass historical authenticated
        // envelopes, then reach fresh reminders without firing stale alerts.
        for(int days=30;days>=1;days--) {
            long timestamp=NOW-days*86400000L;
            RelayPolicy.validate(2,"outer","outer",timestamp,NOW);
            check(!RelayPolicy.shouldNotify(timestamp,NOW));
        }
        RelayPolicy.validate(2,"outer","outer",NOW-10000,NOW);
        check(RelayPolicy.shouldNotify(NOW-10000,NOW));
        rejected(1,"outer",NOW);
        rejected(2,"wrong",NOW);
        rejected(2,"outer",0);
        rejected(2,"outer",NOW+6*60000);
        // Ten maximum-size relay wires plus JSON overhead fit within the reader.
        check(RelayPolicy.PAGE_SIZE*(80*1024+1024)<RelayPolicy.MAX_RESPONSE_BYTES);
        System.out.println("Historical backlog, fresh alerts, validation and page bounds passed");
    }
}
