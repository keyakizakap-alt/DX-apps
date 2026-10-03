import worker from '../dist/server/index.js';
import { createVercelHandler } from '../server/vercel-handler.mjs';

const handler = createVercelHandler(worker);
export default {
  fetch(request) { return handler(request, process.env); }
};
