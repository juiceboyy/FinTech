import { schedule } from '@netlify/functions';
import { cronService } from '../../src/scheduler/cronService.js';

export const handler = schedule('30 7 * * *', async () => {
  console.log('[Netlify Scheduled Function] Daily morning financial goals digest starting...');
  try {
    const digest = await cronService.runMorningDigest();
    console.log(
      `[Netlify Scheduled Function] Morning digest generated. Email sent: ${digest.emailResult.sent}`
    );
    return {
      statusCode: 200,
    };
  } catch (err) {
    console.error('[Netlify Scheduled Function] Error during morning digest execution:', err);
    return {
      statusCode: 500,
    };
  }
});
