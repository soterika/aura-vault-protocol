# ADR-005: BullMQ for Transaction Processing

## Status

Accepted

## Context

The Aura Vault Protocol requires robust background job processing for several critical operations:
- Yield calculation and APY snapshots
- Email notifications and alerts  
- On-chain transaction submission and monitoring
- Data synchronization with Stellar Horizon API
- Periodic maintenance tasks and cleanup

We evaluated several job queue solutions:

1. **BullMQ**: Redis-based queue with advanced features and excellent Node.js integration
2. **Agenda**: MongoDB-based job scheduling with simpler setup
3. **Kue**: Redis-based but less actively maintained
4. **AWS SQS**: Managed cloud queue service
5. **RabbitMQ**: Full-featured message broker with AMQP protocol
6. **Simple cron jobs**: Basic scheduled tasks without queuing

Requirements include retry logic, job prioritization, delayed execution, monitoring, and reliability.

## Decision

We will use BullMQ as our primary job queue system for background transaction processing and task scheduling.

## Consequences

### Positive

- **Reliability**: Built-in retry mechanisms with exponential backoff and dead letter queues
- **Performance**: Redis-based storage provides fast job enqueueing and processing
- **Monitoring**: Excellent dashboard and metrics integration for operational visibility
- **Advanced features**: Job delays, priorities, rate limiting, and job dependencies out of the box
- **TypeScript support**: First-class TypeScript integration with type-safe job definitions
- **Horizontal scaling**: Multiple worker instances can process jobs concurrently
- **Redis integration**: Leverages existing Redis infrastructure, reducing operational overhead
- **Active maintenance**: Well-maintained library with regular updates and community support
- **Flow control**: Built-in flow orchestration for complex multi-step job workflows

### Negative

- **Redis dependency**: Requires Redis availability for job processing (already mitigated by ADR-004)
- **Complexity**: More sophisticated than simple cron jobs, requires understanding of queue concepts
- **Memory usage**: Job data stored in Redis counts against memory allocation
- **Debugging**: Asynchronous job failures can be harder to trace than synchronous operations
- **Lock-in**: Tight coupling to BullMQ-specific features may complicate future migrations

### Neutral

- **Learning curve**: Team needs familiarity with job queue patterns and BullMQ API
- **Error handling**: Requires thoughtful design of retry policies and failure scenarios  
- **Monitoring setup**: Need operational monitoring for queue depth, processing rates, and failures

## Notes

BullMQ implementation includes:

**Job Types:**
- `yield-calculation`: Periodic APY calculations and historical snapshots
- `email-notification`: User alerts and system notifications  
- `transaction-monitor`: Tracking on-chain transaction status
- `horizon-sync`: Synchronizing Stellar network events
- `cleanup`: Periodic database and cache maintenance

**Queue Configuration:**
```typescript
// Example job definition
interface YieldCalculationJob {
  vaultAddress: string;
  blockHeight: number;
  userId?: string;
}

// Worker configuration with retry and timeout
const yieldWorker = new Worker('yield-calculation', async (job) => {
  // Job processing logic
}, {
  connection: redisConnection,
  concurrency: 5,
  removeOnComplete: 10,
  removeOnFail: 50,
});
```

**Reliability Features:**
- Exponential backoff retry with maximum attempt limits
- Dead letter queue for permanently failed jobs
- Job progress tracking and status updates
- Graceful shutdown handling to complete in-flight jobs

**Operational Benefits:**
- Web dashboard for job monitoring and manual intervention
- Prometheus metrics integration for alerting
- Job scheduling with cron expressions for recurring tasks
- Priority queues for time-sensitive operations

Alternative solutions rejected:
- **Agenda**: MongoDB dependency doesn't align with PostgreSQL + Redis architecture
- **AWS SQS**: Vendor lock-in and additional cloud service costs
- **RabbitMQ**: Over-engineered for our relatively simple job processing needs
- **Cron jobs**: Lack retry logic, monitoring, and distributed processing capabilities

References:
- [BullMQ Documentation](https://docs.bullmq.io/)
- [BullMQ Dashboard](https://github.com/bee-queue/arena)
- [Redis Streams](https://redis.io/docs/data-types/streams/)