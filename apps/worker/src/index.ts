const { randomUUID } = require("node:crypto");
const RedisConsumer = require("./consumer");

async function main(): Promise<void> {
  const workerId = process.env.WORKER_ID || randomUUID();
  const consumer = new RedisConsumer(workerId);

  const shutdown = async () => {
    await consumer.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });

  await consumer.start();
}

void main();
