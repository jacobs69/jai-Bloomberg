import { createApp } from "./app.js";

const app = createApp();

if (!process.env.VERCEL) {
  const PORT = Number(process.env.API_PORT ?? 4000);
  const HOST = process.env.API_HOST ?? "127.0.0.1";
  app.listen(PORT, HOST, () => {
    console.log(`MARKETFORGE API listening on http://${HOST}:${PORT}`);
  });
}

export default app;
