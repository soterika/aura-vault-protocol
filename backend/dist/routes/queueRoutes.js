import { Router } from "express";
import { queueMetrics, listJobs, getJob, getDeadLetterJobs } from "../queue.js";
export const queueRouter = Router();
/** GET /api/v1/queue/metrics — queue health dashboard */
queueRouter.get("/metrics", (_req, res) => {
    res.json(queueMetrics());
});
/** GET /api/v1/queue/dashboard — extended metrics + recent jobs */
queueRouter.get("/dashboard", (_req, res) => {
    const metrics = queueMetrics();
    const recentCompleted = listJobs("completed").slice(-20);
    const recentDead = getDeadLetterJobs().slice(-10);
    const active = listJobs("active");
    const waiting = listJobs("waiting");
    res.json({
        metrics,
        active,
        waiting: waiting.slice(0, 20),
        recentCompleted,
        recentDead,
        timestamp: new Date().toISOString(),
    });
});
/** GET /api/v1/queue/jobs/:id — single job status */
queueRouter.get("/jobs/:id", (req, res) => {
    const job = getJob(req.params.id);
    if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
    }
    res.json(job);
});
/** GET /api/v1/queue/dlq — dead-letter queue */
queueRouter.get("/dlq", (_req, res) => {
    res.json(getDeadLetterJobs());
});
