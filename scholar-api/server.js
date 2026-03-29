import app from "./src/app.js";

const PORT = process.env.PORT || 8029;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 http://localhost:${PORT}`);
  console.log(`📄 http://localhost:${PORT}/docs`);
});