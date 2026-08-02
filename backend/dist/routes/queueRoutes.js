import { Router } from "express";
import { queueMetrics, listJobs, getJob, getDeadLetterJobs } from "../queue.js";
import { parsePagination, paginateArray } from "../middleware/paginationMiddleware.js";
export const queueRouter = Router();
/** GET /api/v1/queue/metrics — queue health dashboard */
queueRouter.get("/metrics", (_req, res) => {
    res.json(queueMetrics());
});
/**
 * GET /api/v1/queue/dashboard — extended metrics + cursor-paginated recent jobs
 * Query params: cursor, limit (default 20, max 100)
 */
queueRouter.get("/dashboard", (req, res) => {
    const { limit, cursor } = parsePagination(req);
    const metrics = queueMetrics();
    const active = listJobs("active");
    const allWaiting = listJobs("waiting");
    const allCompleted = listJobs("completed");
    const allDead = getDeadLetterJobs();
    // Paginate the waiting queue (primary list callers iterate)
    const { data: waitingPage, nextCursor } = paginateArray(allWaiting, (job, index) => ({
        id: typeof job.id === "string" ? job.id : String(index),
        timestamp: typeof job.createdAt === "string" ? job.createdAt : "0",
    }), limit, cursor);
    res.json({
        metrics,
        active,
        waiting: waitingPage,
        nextCursor,
        recentCompleted: allCompleted.slice(-20),
        recentDead: allDead.slice(-10),
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
/**
 * GET /api/v1/queue/dlq — dead-letter queue (cursor-paginated)
 * Query params: cursor, limit (default 20, max 100)
 */
queueRouter.get("/dlq", (req, res) => {
    const { limit, cursor } = parsePagination(req);
    const allDead = getDeadLetterJobs();
    const { data, nextCursor } = paginateArray(allDead, (job, index) => ({
        id: typeof job.id === "string" ? job.id : String(index),
        timestamp: typeof job.createdAt === "string" ? job.createdAt : "0",
    }), limit, cursor);
    res.json({ data, nextCursor });
});
