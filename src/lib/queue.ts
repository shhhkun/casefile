import { Queue, ConnectionOptions } from "bullmq";

export const CLEANUP_QUEUE_NAME = "rag-cleanup";

interface UpstashRedisOptions {
  host: string;
  port: number;
  password: string;
}

/**
 * Derive the Redis protocol endpoint settings from the Upstash REST env vars.
 *
 * Upstash exposes two endpoints for the same database:
 *   - REST:  https://<host>.upstash.io   (used by @upstash/redis)
 *   - Redis: rediss://default:<token>@<host>.upstash.io:6379
 *
 * BullMQ requires a Redis protocol connection (ioredis), so we derive the
 * connection settings from the existing REST URL + REST token. No new
 * secrets are required.
 */
function getUpstashRedisOptions(): UpstashRedisOptions {
  const restUrl = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!restUrl || !token) {
    throw new Error(
      "Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN",
    );
  }

  const host = restUrl.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  return {
    host,
    port: 6379,
    password: token,
  };
}

/**
 * Connection options for the BullMQ worker.
 *
 * `maxRetriesPerRequest: null` is REQUIRED for workers: it lets ioredis
 * put blocking commands (BRPOPLPUSH) on hold indefinitely while still
 * allowing new commands to be queued.
 */
export function getWorkerRedisConnectionOptions(): ConnectionOptions {
  const { host, port, password } = getUpstashRedisOptions();

  return {
    host,
    port,
    password,
    tls: {},
    maxRetriesPerRequest: null,
  };
}

/**
 * Connection options for the BullMQ producer (queue.add).
 *
 * Producers do NOT set `maxRetriesPerRequest: null`: if Redis is briefly
 * unavailable, commands should fail fast so the analyze request is not
 * blocked. Failures are caught by `enqueueCleanup` and logged.
 */
export function getProducerRedisConnectionOptions(): ConnectionOptions {
  const { host, port, password } = getUpstashRedisOptions();

  return {
    host,
    port,
    password,
    tls: {},
  };
}

/**
 * Enqueue a RAG cleanup job (delete expired sources).
 *
 * Fire-and-forget: the caller does not await this. Errors are caught and
 * logged so a queue failure never breaks the analyze request.
 *
 * A fixed `jobId` dedupes jobs: if a cleanup job is already waiting or
 * active, BullMQ will not enqueue another one. This keeps the queue from
 * accumulating duplicate cleanup jobs under load.
 */
export async function enqueueCleanup(): Promise<void> {
  try {
    const queue = new Queue(CLEANUP_QUEUE_NAME, {
      connection: getProducerRedisConnectionOptions(),
    });

    try {
      await queue.add(
        "cleanup-expired-sources",
        {},
        {
          jobId: "cleanup-expired-sources",
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } finally {
      await queue.close();
    }
  } catch (err) {
    console.error("RAG: failed to enqueue cleanup job:", err);
  }
}
