import { schedule } from '@netlify/functions';
import { cronService } from '../../src/scheduler/cronService.js';

export const handler = schedule('0 9 1,15 * *', async () => {
  console.log('[Netlify Scheduled Function] Bimonthly health check starting...');
  try {
    const report = await cronService.runRoutine();
    console.log(`[Netlify Scheduled Function] Successfully produced report ${report.id}`);
    return {
      statusCode: 200,
    };
  } catch (err) {
    console.error('[Netlify Scheduled Function] Error during routine execution:', err);
    return {
      statusCode: 500,
    };
  }
});
