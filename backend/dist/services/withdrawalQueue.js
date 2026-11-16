import { randomUUID } from "crypto";
const jobs = new Map();
let processorInterval = null;
export function enqueueWithdrawal(walletAddress, shares, contractId) {
    const job = {
        id: randomUUID(),
        walletAddress,
        shares,
        contractId,
        status: "pending",
        createdAt: new Date().toISOString(),
    };
    jobs.set(job.id, job);
    return job;
}
export function getWithdrawalJob(jobId) {
    return jobs.get(jobId);
}
export function getQueueStats() {
    let pending = 0, processing = 0, completed = 0, failed = 0;
    for (const job of jobs.values()) {
        if (job.status === "pending")
            pending++;
        else if (job.status === "processing")
            processing++;
        else if (job.status === "completed")
            completed++;
        else if (job.status === "failed")
            failed++;
    }
    return { pending, processing, completed, failed, total: jobs.size };
}
async function processNextWithdrawal() {
    const next = [...jobs.values()].find((j) => j.status === "pending");
    if (!next)
        return;
    next.status = "processing";
    try {
        // TODO: replace with actual Soroban RPC call to submit withdraw tx
        await new Promise((r) => setTimeout(r, 100));
        next.txHash = `mock_tx_${next.id.slice(0, 8)}`;
        next.status = "completed";
    }
    catch (err) {
        next.status = "failed";
        next.error = err?.message ?? "unknown error";
    }
    next.processedAt = new Date().toISOString();
}
export function startWithdrawalProcessor(intervalMs = 10_000) {
    if (processorInterval)
        return;
    processorInterval = setInterval(() => {
        processNextWithdrawal().catch(console.error);
    }, intervalMs);
}
export function stopWithdrawalProcessor() {
    if (processorInterval) {
        clearInterval(processorInterval);
        processorInterval = null;
    }
}
