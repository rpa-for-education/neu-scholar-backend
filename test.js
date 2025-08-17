// test-qwen.js
import 'dotenv/config';
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.QWEN_API_KEY,
  baseURL: process.env.QWEN_BASE_URL,
});

async function main() {
  try {
    console.log("🔹 Test Chat với Qwen...");
    const chatResp = await client.chat.completions.create({
      model: process.env.QWEN_MODEL || "qwen-max",
      messages: [
        { role: "system", content: "Bạn là một trợ lý AI hữu ích." },
        { role: "user", content: "Xin chào, bạn có hoạt động không?" }
      ],
    });
    console.log("💬 Qwen Chat:", chatResp.choices[0].message.content);

    console.log("\n🔹 Test Embedding với Qwen...");
    const embedResp = await client.embeddings.create({
      model: "text-embedding-v2",   // ✅ sửa model embedding
      input: "Trí tuệ nhân tạo và khoa học máy tính",
    });
    console.log("📏 Chiều dài vector:", embedResp.data[0].embedding.length);

  } catch (err) {
    console.error("❌ Qwen API error:", err.response?.data || err.message);
  }
}

main();
