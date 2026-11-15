import { createApp } from "./app.js";

const app = createApp();

// Vercel detects the default Express export and adapts it to a Function.
// Outside Vercel, keep the standalone listener for local development and Docker.
export default app;

if (process.env.VERCEL !== "1") {
  const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  const HOST = process.env.API_HOST ?? "127.0.0.1";
  app.listen(PORT, HOST, () => {
    console.log(`MARKETFORGE API listening on http://${HOST}:${PORT}`);
  });
}
