import 'dotenv/config';
import { createApp } from './server/app.js';
import { mcpClient } from './mcp/client.js';
import { cronService } from './scheduler/cronService.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function bootstrap() {
  console.log('--- Initializing Zenmoney Fintech Application ---');

  // Attempt initial connection to remote Zenmoney MCP endpoint
  const connected = await mcpClient.connect();
  if (connected) {
    console.log('Connected to remote Zenmoney MCP endpoint at', process.env.ZENMONEY_MCP_URL || 'https://api.zenmoney.app/mcp');
  } else {
    console.log('Operating in Mock Data Mode (No live Zenmoney session or endpoint unreachable).');
  }

  // Start bimonthly cron scheduler (1st and 15th)
  cronService.start();

  // Start Web Server & Dashboard
  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`Fintech Dashboard & API running at http://localhost:${PORT}`);
    console.log(`API Status endpoint: http://localhost:${PORT}/api/status`);
    console.log(`Latest Report endpoint: http://localhost:${PORT}/api/reports/latest`);
  });

  // Graceful termination
  const shutdown = async () => {
    console.log('\nShutting down gracefully...');
    cronService.stop();
    await mcpClient.disconnect();
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
