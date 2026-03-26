// import_fund_other_full.js
import fs from "fs";
import csv from "csv-parser";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import crypto from "crypto";

dotenv.config();

const FILE_PATH = "./services/data_other_funds.csv";
const BATCH_SIZE = 500;

const client = new MongoClient(process.env.MONGO_URI);

// ===== HELPER =====
const genKey = v =>
  v ? crypto.createHash("md5").update(String(v)).digest("hex") : null;

const clean = v =>
  typeof v === "string" ? v.trim() || null : v ?? null;

const stripHTML = html =>
  html ? html.replace(/<[^>]*>/g, "").trim() : null;

const parseDate = d => {
  if (!d) return null;
  const date = new Date(d);
  return isNaN(date) ? null : date;
};

const parseNum = v => {
  if (!v) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
};

// ===== MAP FULL =====
function mapRow(r) {
  const key = r.opportunity_number || r.opportunity_id || r.url;
  const u_key = genKey(key);
  if (!u_key) return null;

  return {
    u_key,

    // ===== CORE =====
    opportunity_id: clean(r.opportunity_id),
    opportunity_number: clean(r.opportunity_number),
    opportunity_title: clean(r.opportunity_title),
    opportunity_status: clean(r.opportunity_status),

    // ===== AGENCY =====
    agency_code: clean(r.agency_code),
    agency_name: clean(r.agency_name),
    top_level_agency_name: clean(r.top_level_agency_name),

    agency_contact: clean(r.agency_contact_description),
    agency_email: clean(r.agency_email_address),

    // ===== CATEGORY =====
    category: clean(r.category),
    category_explanation: clean(r.category_explanation),

    funding_categories: clean(r.funding_categories),
    funding_category_description: clean(r.funding_category_description),

    assistance_listings: clean(r.opportunity_assistance_listings),

    // ===== FUNDING =====
    funding_amount: parseNum(r.estimated_total_program_funding),
    award_ceiling: parseNum(r.award_ceiling),
    award_floor: parseNum(r.award_floor),
    expected_awards: parseNum(r.expected_number_of_awards),

    funding_instruments: clean(r.funding_instruments),

    // ===== ELIGIBILITY =====
    applicant_types: clean(r.applicant_types),
    applicant_description: clean(r.applicant_eligibility_description),

    is_cost_sharing: clean(r.is_cost_sharing),

    // ===== DATE =====
    post_date: parseDate(r.post_date),
    close_date: parseDate(r.close_date),
    archive_date: parseDate(r.archive_date),

    forecast_post_date: parseDate(r.forecasted_post_date),
    forecast_close_date: parseDate(r.forecasted_close_date),
    forecast_award_date: parseDate(r.forecasted_award_date),
    forecast_start_date: parseDate(r.forecasted_project_start_date),

    fiscal_year: clean(r.fiscal_year),
    is_forecast: clean(r.is_forecast),

    created_source: parseDate(r.created_at),
    updated_source: parseDate(r.updated_at),

    // ===== LINK =====
    url: clean(r.url),
    additional_info_url: clean(r.additional_info_url),
    additional_info_desc: clean(r.additional_info_url_description),

    // ===== DESCRIPTION =====
    description: stripHTML(r.summary_description),

    // ===== SEARCH =====
    text: [
      r.opportunity_title,
      r.agency_name,
      r.category,
      r.funding_categories,
      r.summary_description
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),

    // ===== RAW =====
    raw: r,

    updatedAt: new Date()
  };
}

// ===== MAIN =====
async function run() {
  console.log("🚀 IMPORT GRANTS (FULL REAL MAPPING)");

  await client.connect();
  const col = client.db(process.env.DB_NAME).collection("fund");

  let batch = [];
  let inserted = 0;
  let updated = 0;
  let total = 0;

  const stream = fs.createReadStream(FILE_PATH).pipe(
    csv({ mapHeaders: ({ header }) => header.toLowerCase().trim() })
  );

  for await (const row of stream) {
    const data = mapRow(row);
    if (!data) continue;

    batch.push({
      updateOne: {
        filter: { u_key: data.u_key },
        update: {
          $set: data,
          $setOnInsert: { createdAt: new Date() }
        },
        upsert: true
      }
    });

    if (batch.length >= BATCH_SIZE) {
      const res = await col.bulkWrite(batch);

      inserted += res.upsertedCount;
      updated += res.modifiedCount;
      total += batch.length;

      console.log("⚡ batch:", { total, inserted, updated });

      batch = [];
    }
  }

  if (batch.length) {
    const res = await col.bulkWrite(batch);

    inserted += res.upsertedCount;
    updated += res.modifiedCount;
    total += batch.length;
  }

  console.log("🎯 DONE");
  console.log("🆕 Insert:", inserted);
  console.log("🔄 Update:", updated);
  console.log("📦 Total:", total);

  await client.close();
}

run();