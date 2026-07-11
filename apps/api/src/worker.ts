// BullMQ worker entrypoint (STUB).
//
// Async jobs go through BullMQ (PLAN.md section 5):
//   export / e-Tax / notification / PM schedule generation.
// Exports are async jobs per docs/handoff/api-contract.md note 3:
//   POST /exports {type,params} -> GET /exports/:id (url when done).
//
// TODO(P0-BE-13): implement the queue processors:
//   - export:      async report export -> file URL when done
//   - etax:        e-Tax queue send (status superset per decision C4,
//                  PLAN.md Appendix C)
//   - notification: fan-out via @juneflow/notifications adapters
//                  (line / email / webpush - integrations zone, mock-first)
//   - pm-schedule: PM contract mode=visits -> server auto-gens schedule + WOs
//                  (docs/handoff/api-contract.md, PM section)

import { Worker } from "bullmq";

export const QUEUE_NAMES = [
  "export",
  "etax",
  "notification",
  "pm-schedule",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

const connection = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const workers = QUEUE_NAMES.map(
  (name) =>
    new Worker(
      name,
      async (job) => {
        // TODO(P0-BE-13): route to the real processor per queue name.
        throw new Error(
          `NOT_IMPLEMENTED: processor for queue "${name}" job ${job.id} (P0-BE-13)`,
        );
      },
      { connection },
    ),
);

for (const worker of workers) {
  worker.on("failed", (job, err) => {
    console.error(`[worker:${worker.name}] job ${job?.id} failed:`, err.message);
  });
}

const shutdown = async (): Promise<void> => {
  await Promise.all(workers.map((worker) => worker.close()));
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log(`Juneflow worker up - queues: ${QUEUE_NAMES.join(", ")}`);
