// agents/fund/fund.hybrid.js
import { searchFund } from "./fund.search.js";
import { getDb } from "../../db/mongo.js";

// ================= KEYWORD SEARCH =================
async function keywordSearch(query, limit = 10) {
  const db = await getDb();

  const regex = new RegExp(query, "i");

  const docs = await db.collection("fund").find({
    $or: [
      { "OPPORTUNITY TITLE": regex },
      { "FUNDING DESCRIPTION": regex },
      { "CATEGORY OF FUNDING ACTIVITY": regex },
    ],
  })
  .limit(limit)
  .toArray();

  return docs.map(d => ({
    payload: {
      title: d["OPPORTUNITY TITLE"],
      agency: d["AGENCY NAME"],
      text: d["FUNDING DESCRIPTION"],
      deadline: d["ESTIMATED APPLICATION DUE DATE"],
      amount: d["ESTIMATED TOTAL FUNDING"],
    },
    score: 0.5 // base score
  }));
}

// ================= MERGE =================
function mergeResults(vectorResults, keywordResults) {
  const map = new Map();

  [...vectorResults, ...keywordResults].forEach(r => {
    const key = r.payload?.title;

    if (!map.has(key)) {
      map.set(key, r);
    } else {
      // boost nếu trùng
      map.get(key).score += 0.2;
    }
  });

  return Array.from(map.values());
}

// ================= FILTER =================
function filter(results, query) {
  const yearMatch = query.match(/20\d{2}/);
  const year = yearMatch ? Number(yearMatch[0]) : null;

  return results.filter(r => {
    const text = (r.payload?.text || "").toLowerCase();

    const relevant =
      text.includes("ai") ||
      text.includes("automation") ||
      text.includes("workflow") ||
      text.includes("system");

    if (!relevant) return false;

    if (year) {
      const d = new Date(r.payload?.deadline);
      if (!isNaN(d) && d.getFullYear() !== year) return false;
    }

    return true;
  });
}

// ================= MAIN =================
export async function hybridSearchFund(query, topk = 5) {
  const vector = await searchFund(query, topk * 2);
  const keyword = await keywordSearch(query, topk * 2);

  const merged = mergeResults(vector, keyword);

  const filtered = filter(merged, query);

  return filtered;
}