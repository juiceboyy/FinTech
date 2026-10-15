import express, { type Application } from 'express';
import path from 'node:path';
import { apiRouter } from './routes.js';

export function createApp(): Application {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Static Assets (Dashboard)
  const publicDir = path.resolve(process.cwd(), 'public');
  app.use(express.static(publicDir));

  // Mount API
  app.use('/api', apiRouter);

  // Direct root fallback to index.html
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}
