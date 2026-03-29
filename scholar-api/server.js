// server.js
import app from "./src/app.js";

const PORT = 8025;

app.listen(PORT, () => {
  console.log(`🚀 http://localhost:${PORT}`);
  console.log(`📄 http://localhost:${PORT}/docs`);
});