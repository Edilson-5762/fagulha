import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 4000);

createServer().listen(port, () => {
  console.log(`signaling-server listening on port ${port}`);
});
