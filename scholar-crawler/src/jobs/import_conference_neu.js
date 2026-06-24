import fs from "fs";
import csv from "csv-parser";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import {
getDb,
closeDb
} from "../services/mongo.js";

/* ================= CONFIG ================= */
const BATCH_SIZE = 500;

/* ================= PATH ================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FILE_PATH = path.join(
__dirname,
"../data/data_hoi_thao_neu_2026.csv"
);

/* ================= HELPERS ================= */
const genKey = value =>
crypto
.createHash("md5")
.update(String(value))
.digest("hex");

function parseTopics(topics) {
if (!topics) return [];

return topics
.split(",")
.map(item => item.trim())
.filter(Boolean);
}

function normalizeRow(row) {
const doc = {};

for (const [key, value] of Object.entries(row)) {
const normalizedKey = key
.trim()
.toLowerCase()
.replace(/[^a-z0-9]+/g, "*")
.replace(/^*|_$/g, "");

```
doc[normalizedKey] =
  value === "" ? null : value;
```

}

return doc;
}

/* ================= MAIN ================= */
async function run() {
console.log(
"🚀 START NEU CONFERENCE IMPORT"
);

console.log(
"📂 FILE:",
FILE_PATH
);

const db = await getDb();
const col =
db.collection("conference");

/* ================= INDEX ================= */

await col.createIndex(
{ u_key: 1 },
{ unique: true }
);

await col.createIndex({
source: 1
});

await col.createIndex({
status: 1
});

await col.createIndex({
start_date: 1
});

await col.createIndex({
deadline: 1
});

console.log("✅ Index ready");

let processed = 0;
let inserted = 0;
let batch = [];

const stream = fs
.createReadStream(FILE_PATH)
.pipe(csv());

for await (const rawRow of stream) {
const row =
normalizeRow(rawRow);

```
const sourceId =
  row._key ||
  row.acronym ||
  row.name;

if (!sourceId) {
  continue;
}

const u_key =
  genKey(
    `neu:${sourceId}`
  );

const now = new Date();

const doc = {
  ...row,

  u_key,

  _key:
    row._key ||
    sourceId,

  acronym:
    row.acronym ||
    null,

  name:
    row.name ||
    null,

  location:
    row.location ||
    null,

  city:
    row.city ||
    null,

  country:
    row.country ||
    null,

  country_code:
    row.country_code ||
    null,

  continent:
    row.continent ||
    null,

  deadline:
    row.deadline ||
    null,

  start_date:
    row.start_date ||
    null,

  topics:
    parseTopics(
      row.topics
    ),

  url:
    row.url ||
    null,

  cfp_text:
    row.cfp_text ||
    null,

  crawl_source:
    "neu",

  source:
    "neu",

  status:
    "completed",

  is_enriched:
    true,

  updatedAt:
    now
};

batch.push({
  updateOne: {
    filter: {
      u_key
    },

    update: {
      $set: doc,

      $setOnInsert: {
        createdAt: now
      }
    },

    upsert: true
  }
});

processed++;

if (
  batch.length >=
  BATCH_SIZE
) {
  const result =
    await col.bulkWrite(
      batch,
      {
        ordered: false
      }
    );

  inserted +=
    result.upsertedCount ||
    0;

  batch = [];
}

if (
  processed % 1000 ===
  0
) {
  console.log(
    `📊 Processed: ${processed}`
  );
}
```

}

if (batch.length) {
const result =
await col.bulkWrite(
batch,
{
ordered: false
}
);

```
inserted +=
  result.upsertedCount ||
  0;
```

}

console.log(
`📊 Total rows: ${processed}`
);

console.log(
`➕ New records: ${inserted}`
);

console.log(
"🎯 CONFERENCE DONE"
);
}

run()
.then(async () => {
try {
await closeDb();
} catch {}

```
console.log(
  "🔒 Mongo closed"
);

process.exit(0);
```

})
.catch(async err => {
console.error(
"❌ CONFERENCE IMPORT ERROR"
);

```
console.error(err);

try {
  await closeDb();
} catch {}

process.exit(1);
```

});