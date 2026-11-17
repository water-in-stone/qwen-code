package com.alibaba.qwen.code.runtimebroker.persistence;

import com.alibaba.qwen.code.runtimebroker.RuntimeBindingRecord;
import com.alibaba.qwen.code.runtimebroker.RuntimeCapacityPolicy;

import java.math.BigInteger;
import java.sql.Connection;
import java.util.ArrayList;
import java.sql.SQLException;

/** Capacity observation participates in the caller's binding transaction. */
public final class JdbcRuntimeCapacity {
    private JdbcRuntimeCapacity() {}

    public record Observation(String detail, boolean warning) {}

    public static Observation observe(Connection connection) throws SQLException {
        var domains = new ArrayList<String>();
        boolean warning = false;
        try (var select = connection.prepareStatement("SELECT d.domain_id, d.domain_bytes, "
                + "d.control_bytes, d.harness_bytes, d.reserve_bytes, d.worker_bytes, d.max_runtimes, "
                + "COUNT(r.id) AS held, COALESCE(SUM(r.reserved_bytes), 0) AS held_bytes "
                + "FROM ma_capacity_domain d LEFT JOIN ma_capacity_reservation r "
                + "ON r.domain_id = d.domain_id AND r.reservation_state = 'HELD' "
                + "GROUP BY d.domain_id, d.domain_bytes, d.control_bytes, d.harness_bytes, "
                + "d.reserve_bytes, d.worker_bytes, d.max_runtimes ORDER BY d.domain_id");
                var rows = select.executeQuery()) {
            while (rows.next()) {
                long held = rows.getLong("held");
                BigInteger fixed = BigInteger.valueOf(rows.getLong("control_bytes"))
                        .add(BigInteger.valueOf(rows.getLong("harness_bytes")))
                        .add(BigInteger.valueOf(rows.getLong("reserve_bytes")));
                BigInteger reserved = rows.getBigDecimal("held_bytes").toBigIntegerExact();
                BigInteger budget = BigInteger.valueOf(rows.getLong("domain_bytes"));
                boolean over = held > rows.getLong("max_runtimes")
                        || fixed.add(reserved).compareTo(budget) > 0;
                warning |= over;
                domains.add(rows.getString("domain_id") + "{mode=observe, held=" + held
                        + ", reserved-bytes=" + reserved + ", fixed-bytes=" + fixed
                        + ", budget-bytes=" + budget + ", max-runtimes=" + rows.getLong("max_runtimes")
                        + ", over-budget=" + over + "}");
            }
        }
        long unaccounted;
        try (var select = connection.prepareStatement("SELECT COUNT(*) FROM ma_runtime_binding b "
                + "WHERE NOT EXISTS (SELECT 1 FROM ma_capacity_reservation r "
                + "WHERE r.binding_id = b.binding_id AND r.runtime_generation = b.runtime_generation)");
                var rows = select.executeQuery()) {
            rows.next();
            unaccounted = rows.getLong(1);
        }
        warning |= !domains.isEmpty() && unaccounted > 0;
        return new Observation("capacity-domains=" + (domains.isEmpty() ? "unconfigured" : domains)
                + "; unaccounted-binding-records=" + unaccounted
                + "; reservation-kind=configured-estimate; admission=not enforced", warning);
    }

    static void lockDomain(Connection connection, RuntimeCapacityPolicy policy) throws SQLException {
        if (policy == null) {
            return;
        }
        try (var insert = connection.prepareStatement("INSERT INTO ma_capacity_domain "
                + "(domain_id, policy_version, mode, domain_bytes, control_bytes, harness_bytes, "
                + "reserve_bytes, worker_bytes, max_runtimes) VALUES (?, 1, 'observe', ?, ?, ?, ?, ?, ?) "
                + "ON DUPLICATE KEY UPDATE domain_id = domain_id")) {
            insert.setString(1, policy.domainId());
            insert.setLong(2, policy.domainBytes());
            insert.setLong(3, policy.controlBytes());
            insert.setLong(4, policy.harnessBytes());
            insert.setLong(5, policy.reserveBytes());
            insert.setLong(6, policy.workerBytes());
            insert.setLong(7, policy.maxRuntimes());
            insert.executeUpdate();
        }
        try (var select = connection.prepareStatement("SELECT policy_version, mode, domain_bytes, "
                + "control_bytes, harness_bytes, reserve_bytes, worker_bytes, max_runtimes "
                + "FROM ma_capacity_domain WHERE domain_id = ? FOR UPDATE")) {
            select.setString(1, policy.domainId());
            try (var row = select.executeQuery()) {
                if (!row.next() || row.getLong("policy_version") != 1
                        || !"observe".equals(row.getString("mode"))
                        || row.getLong("domain_bytes") != policy.domainBytes()
                        || row.getLong("control_bytes") != policy.controlBytes()
                        || row.getLong("harness_bytes") != policy.harnessBytes()
                        || row.getLong("reserve_bytes") != policy.reserveBytes()
                        || row.getLong("worker_bytes") != policy.workerBytes()
                        || row.getLong("max_runtimes") != policy.maxRuntimes()) {
                    throw new IllegalStateException("Capacity domain policy differs from the durable policy");
                }
            }
        }
    }

    static void observe(Connection connection, RuntimeCapacityPolicy policy,
            RuntimeBindingRecord binding, boolean created) throws SQLException {
        if (policy == null || !"local-process".equals(binding.getRequest().getProvisionerKind())) {
            return;
        }
        try (var query = connection.prepareStatement("SELECT domain_id, reserved_bytes, reservation_state "
                + "FROM ma_capacity_reservation WHERE binding_id = ? AND runtime_generation = ?")) {
            query.setString(1, binding.getBindingId());
            query.setLong(2, binding.getGeneration());
            try (var row = query.executeQuery()) {
                if (row.next()) {
                    if (!policy.domainId().equals(row.getString("domain_id"))
                            || row.getLong("reserved_bytes") != policy.workerBytes()
                            || !"HELD".equals(row.getString("reservation_state"))) {
                        throw new IllegalStateException("Capacity reservation identity differs");
                    }
                    return;
                }
            }
        }
        if (!created) {
            return;
        }
        try (var insert = connection.prepareStatement("INSERT INTO ma_capacity_reservation "
                + "(domain_id, binding_id, runtime_generation, reserved_bytes, reservation_state) "
                + "VALUES (?, ?, ?, ?, 'HELD')")) {
            insert.setString(1, policy.domainId());
            insert.setString(2, binding.getBindingId());
            insert.setLong(3, binding.getGeneration());
            insert.setLong(4, policy.workerBytes());
            insert.executeUpdate();
        }
    }

    static void releaseProven(Connection connection, RuntimeBindingRecord binding) throws SQLException {
        if (binding.getState() != RuntimeBindingRecord.State.RELEASED) {
            return;
        }
        String evidence;
        if (binding.getDrainReceipt() != null && binding.getDrainReceipt().matches(binding)) {
            evidence = binding.getDrainReceipt().toJson();
        } else if (binding.hasStoppedWriters()) {
            evidence = binding.getStopEvidence().toJson();
        } else {
            return;
        }
        try (var update = connection.prepareStatement("UPDATE ma_capacity_reservation "
                + "SET reservation_state = 'RELEASED', release_evidence_json = ? "
                + "WHERE binding_id = ? AND runtime_generation = ? AND reservation_state = 'HELD'")) {
            update.setString(1, evidence);
            update.setString(2, binding.getBindingId());
            update.setLong(3, binding.getGeneration());
            update.executeUpdate();
        }
    }

    static boolean held(Connection connection, String bindingId) throws SQLException {
        try (var query = connection.prepareStatement("SELECT id FROM ma_capacity_reservation "
                + "WHERE binding_id = ? AND reservation_state = 'HELD'")) {
            query.setString(1, bindingId);
            try (var row = query.executeQuery()) {
                return row.next();
            }
        }
    }
}
