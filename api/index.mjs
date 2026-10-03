import worker from '../dist/server/index.js';
import { createVercelHandler } from '../server/vercel-session.mjs';

const handler = createVercelHandler(worker);
export default {
  fetch(request) { return handler(request, process.env); }
};
