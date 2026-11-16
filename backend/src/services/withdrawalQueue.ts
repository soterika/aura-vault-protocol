import { randomUUID } from "crypto";
import { logger } from "../logger.js";

export interface WithdrawalJob {
  id: string;
  walletAddress: string;
  shares: string;
  contractId: string;
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  processedAt?: string;
  txHash?: string;
  error?: string;
}

const jobs = new Map<string, WithdrawalJob>();
let processorInterval: ReturnType<typeof setInterval> | null = null;

export function enqueueWithdrawal(
  walletAddress: string,
  shares: string,
  contractId: string
): WithdrawalJob {
  const job: WithdrawalJob = {
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

export function getWithdrawalJob(jobId: string): WithdrawalJob | undefined {
  return jobs.get(jobId);
}

export function getQueueStats() {
  let pending = 0, processing = 0, completed = 0, failed = 0;
  for (const job of jobs.values()) {
    if (job.status === "pending") pending++;
    else if (job.status === "processing") processing++;
    else if (job.status === "completed") completed++;
    else if (job.status === "failed") failed++;
  }
  return { pending, processing, completed, failed, total: jobs.size };
}

async function processNextWithdrawal(): Promise<void> {
  const next = [...jobs.values()].find((j) => j.status === "pending");
  if (!next) return;

  next.status = "processing";
  try {
    // TODO: replace with actual Soroban RPC call to submit withdraw tx
    await new Promise((r) => setTimeout(r, 100));
    next.txHash = `mock_tx_${next.id.slice(0, 8)}`;
    next.status = "completed";
  } catch (err: any) {
    next.status = "failed";
    next.error = err?.message ?? "unknown error";
  }
  next.processedAt = new Date().toISOString();
}

export function startWithdrawalProcessor(intervalMs = 10_000): void {
  if (processorInterval) return;
  processorInterval = setInterval(() => {
    processNextWithdrawal().catch((err) => logger.error({ err }, "[withdrawalQueue] processNextWithdrawal failed"));
  }, intervalMs);
}

export function stopWithdrawalProcessor(): void {
  if (processorInterval) {
    clearInterval(processorInterval);
    processorInterval = null;
  }
}
