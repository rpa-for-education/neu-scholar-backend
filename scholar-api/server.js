import app from "./src/app.js";

const PORT = process.env.PORT || 8025;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📄 Swagger docs at http://localhost:${PORT}/docs`);
});