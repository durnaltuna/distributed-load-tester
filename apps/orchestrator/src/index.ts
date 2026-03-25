const OrchestratorApi = require("./api");

async function main(): Promise<void> {
  const port = Number(process.env.PORT || "3000");
  const api = new OrchestratorApi();

  try {
    await api.start(port);
  } catch (error) {
    console.error("Failed to start orchestrator", error);
    process.exit(1);
  }
}

void main();
