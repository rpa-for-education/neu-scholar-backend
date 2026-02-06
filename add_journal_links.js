// add_journal_links.js
import "dotenv/config";
import { getDb } from "./db.js";

(async () => {
  try {
    const db = await getDb();
    const col = db.collection("journal");

    const cursor = col.find({ sourceid: { $exists: true } });

    let count = 0;

    while (await cursor.hasNext()) {
      const j = await cursor.next();

      const scimago_link = j.sourceid
        ? `https://www.scimagojr.com/journalsearch.php?q=${j.sourceid}&tip=sid`
        : null;

      await col.updateOne(
        { _id: j._id },
        { $set: { scimago_link } }
      );

      count++;

      // 👇 LOG TIẾN TRÌNH
      if (count % 500 === 0) {
        console.log(`⏳ Updated ${count} journals...`);
      }
    }

    console.log(`✅ DONE: Updated ${count} journals with Scimago links`);
    process.exit(0);

  } catch (err) {
    console.error("❌ Script failed:", err);
    process.exit(1);
  }
})();
