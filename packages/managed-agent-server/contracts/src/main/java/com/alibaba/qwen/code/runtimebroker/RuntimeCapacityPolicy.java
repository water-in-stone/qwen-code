package com.alibaba.qwen.code.runtimebroker;

/** Deployment-owned reservation estimates; not physical memory measurements. */
public record RuntimeCapacityPolicy(String domainId, long domainBytes,
        long controlBytes, long harnessBytes, long reserveBytes,
        long workerBytes, long maxRuntimes) {
    public RuntimeCapacityPolicy {
        if (domainId == null || !domainId.matches("[A-Za-z0-9._:-]{1,128}")) {
            throw new IllegalArgumentException("Capacity domain ID must contain 1-128 ASCII letters, digits, . _ : or -");
        }
        if (domainBytes <= 0 || controlBytes < 0 || harnessBytes < 0
                || reserveBytes < 0 || workerBytes <= 0 || maxRuntimes <= 0) {
            throw new IllegalArgumentException("Capacity budgets and Runtime limit must be positive");
        }
        try {
            long fixed = Math.addExact(Math.addExact(controlBytes, harnessBytes), reserveBytes);
            if (Math.addExact(fixed, workerBytes) > domainBytes) {
                throw new IllegalArgumentException("Capacity domain cannot hold one worker after fixed reservations");
            }
        } catch (ArithmeticException error) {
            throw new IllegalArgumentException("Capacity budget overflows", error);
        }
    }
}
