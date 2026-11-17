package com.alibaba.qwen.code.runtimebroker.persistence;

import com.alibaba.qwen.code.runtimebroker.RuntimeBindingRecord;
import com.alibaba.qwen.code.runtimebroker.RuntimeCapacityPolicy;
import com.alibaba.qwen.code.runtimebroker.RuntimeDrainReceipt;
import com.alibaba.qwen.code.runtimebroker.RuntimeProvisionRequest;
import com.alibaba.qwen.code.runtimebroker.RuntimeResourceHandle;
import com.alibaba.qwen.code.runtimebroker.RuntimeScope;
import com.alibaba.qwen.code.runtimebroker.adapter.security.AesGcmSecretProtector;
import com.alibaba.qwen.code.runtimebroker.managedschema.ManagedSchema;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import javax.sql.DataSource;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class JdbcRuntimeCapacityTest {
    private static final RuntimeCapacityPolicy POLICY =
            new RuntimeCapacityPolicy("host-1", 1000, 100, 100, 100, 400, 1);
    private DataSource source;

    @BeforeEach
    void initialize() {
        var h2 = new JdbcDataSource();
        h2.setURL("jdbc:h2:mem:capacity-observe-" + UUID.randomUUID()
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        source = h2;
        ManagedSchema.initialize(source);
    }

    static void verifyOnMySql(DataSource source) throws Exception {
        ManagedSchema.initialize(source);
        var test = new JdbcRuntimeCapacityTest();
        test.source = source;
        test.twoBrokersObserveTheSameGenerationExactlyOnce();
        var repository = test.repository(POLICY);
        var created = repository.findOrCreate(request("mysql-other-tenant", "unknown"));
        var claim = repository.claimOperation(created.getBindingId(), "owner", Duration.ofMinutes(1));
        repository.compareAndSet(claim,
                claim.withState(RuntimeBindingRecord.State.FAILED, null, Instant.now()));
        assertEquals(2, test.held());
        assertTrue(test.observation().warning());
    }

    @Test
    void twoBrokersObserveTheSameGenerationExactlyOnce() throws Exception {
        var first = repository(POLICY);
        var second = repository(POLICY);
        try (var executor = Executors.newFixedThreadPool(2)) {
            var a = executor.submit(() -> first.findOrCreate(request("tenant", "session")));
            var b = executor.submit(() -> second.findOrCreate(request("tenant", "session")));
            assertEquals(a.get(10, TimeUnit.SECONDS).getBindingId(), b.get(10, TimeUnit.SECONDS).getBindingId());
        }
        assertEquals(1, held());
        assertTrue(observation().detail().contains("reserved-bytes=400"));
        assertFalse(observation().warning());
    }

    @Test
    void observationReportsOversubscriptionWithoutRefusingWork() throws Exception {
        repository(POLICY).findOrCreate(request("tenant-a", "one"));
        repository(POLICY).findOrCreate(request("tenant-b", "two"));
        assertEquals(2, held());
        assertTrue(observation().warning());
        assertTrue(observation().detail().contains("over-budget=true"));
        assertTrue(observation().detail().contains("admission=not enforced"));
    }

    @Test
    void inconsistentPolicyCannotOverwriteTheSharedBudgetOrLeaveBinding() throws Exception {
        repository(POLICY).findOrCreate(request("tenant", "one"));
        var inconsistent = new RuntimeCapacityPolicy("host-1", 2000, 100, 100, 100, 400, 1);
        assertThrows(IllegalStateException.class,
                () -> repository(inconsistent).findOrCreate(request("tenant", "two")));
        assertEquals(1, held());
        assertTrue(observation().detail().contains("budget-bytes=1000"));
    }

    @Test
    void unknownFailedWorkerKeepsItsReservationAndRetentionEvidence() throws Exception {
        var repository = repository(POLICY);
        var created = repository.findOrCreate(request("tenant", "one"));
        var claim = repository.claimOperation(created.getBindingId(), "owner", Duration.ofMinutes(1));
        var failed = repository.compareAndSet(claim,
                claim.withState(RuntimeBindingRecord.State.FAILED, null, Instant.now()));
        assertNotNull(failed);
        assertEquals(1, held());
        try (var connection = source.getConnection()) {
            assertTrue(JdbcRuntimeCapacity.held(connection, failed.getBindingId()));
        }
    }

    @Test
    void cleanStopReleasesExactlyTheOriginalGenerationAndKeepsProof() throws Exception {
        var repository = repository(POLICY);
        var created = repository.findOrCreate(request("tenant", "one"));
        var claim = repository.claimOperation(created.getBindingId(), "owner", Duration.ofMinutes(1));
        var handle = new RuntimeResourceHandle("local-process", 1, Map.of("provider", "local-process"));
        var draining = claim.withResourceHandle(handle, Instant.now())
                .withDrainRequested(true, Instant.now())
                .withState(RuntimeBindingRecord.State.DRAINING, null, Instant.now());
        draining = repository.compareAndSet(claim, draining);
        var receipt = new RuntimeDrainReceipt(draining.getBindingId(), draining.getGeneration(),
                draining.getProvisionSeed().getProvisionRequestId(), handle, Instant.now());
        var released = repository.compareAndSet(draining, draining.withDrainReceipt(receipt)
                .withState(RuntimeBindingRecord.State.RELEASED, null, Instant.now()));
        assertNotNull(released);
        assertEquals(0, held());
        var next = repository.findOrCreate(request("tenant", "one"));
        assertEquals(created.getGeneration() + 1, next.getGeneration());
        assertEquals(1, held());
        try (var connection = source.getConnection()) {
            JdbcRuntimeCapacity.releaseProven(connection, released);
            assertEquals(1, held());
            try (var statement = connection.createStatement();
                    var rows = statement.executeQuery("SELECT release_evidence_json FROM ma_capacity_reservation "
                            + "WHERE reservation_state = 'RELEASED'")) {
                assertTrue(rows.next());
                assertEquals(receipt.toJson(), rows.getString(1));
            }
        }
    }

    @Test
    void unconfiguredBindingsCannotBeAssignedToAnUnprovenHost() throws Exception {
        repository(null).findOrCreate(request("tenant", "one"));
        assertEquals(0, held());
        assertTrue(observation().detail().contains("capacity-domains=unconfigured"));
        assertTrue(observation().detail().contains("unaccounted-binding-records=1"));
        repository(POLICY).findOrCreate(request("tenant", "one"));
        assertEquals(0, held());
        assertTrue(observation().detail().contains("unaccounted-binding-records=1"));
        assertTrue(observation().warning());
    }

    @Test
    void movingAnExistingGenerationToAnotherDomainIsRejected() throws Exception {
        repository(POLICY).findOrCreate(request("tenant", "one"));
        var other = new RuntimeCapacityPolicy("host-2", 1000, 100, 100, 100, 400, 1);
        assertThrows(IllegalStateException.class,
                () -> repository(other).findOrCreate(request("tenant", "one")));
        assertEquals(1, held());
    }

    @Test
    void observationPreservesTheBindingIdentifierByteBudget() throws Exception {
        String id = "界".repeat(510);
        var repository = new JdbcRuntimeBindingRepository(source,
                new AesGcmSecretProtector("test", new byte[32]), null, () -> id, POLICY);
        assertEquals(id, repository.findOrCreate(request("tenant", "unicode")).getBindingId());
        assertEquals(1, held());
    }

    @Test
    void rejectsOverflowAndIncompleteBudgets() {
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeCapacityPolicy("host", Long.MAX_VALUE, Long.MAX_VALUE, 1, 1, 1, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeCapacityPolicy("host", 100, 50, 50, 0, 1, 1));
        assertThrows(IllegalArgumentException.class,
                () -> new RuntimeCapacityPolicy("host\n", 100, 0, 0, 0, 1, 1));
    }

    private JdbcRuntimeBindingRepository repository(RuntimeCapacityPolicy policy) {
        return new JdbcRuntimeBindingRepository(source, new AesGcmSecretProtector("test", new byte[32]),
                null, () -> UUID.randomUUID().toString(), policy);
    }

    private static RuntimeProvisionRequest request(String tenant, String session) {
        return new RuntimeProvisionRequest(new RuntimeScope(tenant, "workspace", "1", "/workspace",
                "sha256:" + "a".repeat(64), "session"), session, "local-process");
    }

    private long held() throws Exception {
        try (var connection = source.getConnection(); var statement = connection.createStatement();
                var rows = statement.executeQuery("SELECT COUNT(*) FROM ma_capacity_reservation "
                        + "WHERE reservation_state = 'HELD'")) {
            rows.next();
            return rows.getLong(1);
        }
    }

    private JdbcRuntimeCapacity.Observation observation() throws Exception {
        try (var connection = source.getConnection()) {
            return JdbcRuntimeCapacity.observe(connection);
        }
    }
}
