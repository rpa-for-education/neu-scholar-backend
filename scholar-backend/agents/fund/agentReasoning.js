// agentReasoning.js - FINAL STABLE (MINIMAL + SAFE)

export function detectIntent(query = "") {
  const q = query.toLowerCase();

  const intent = {
    country: null,
    year: null,
    keywords: [],
  };

  // ===== COUNTRY =====
  if (q.includes("việt") || q.includes("vietnam")) {
    intent.country = "vietnam";
  }

  if (q.includes("mỹ") || q.includes("usa") || q.includes("united states")) {
    intent.country = "usa";
  }

  // ===== YEAR =====
  const yearMatch = q.match(/\b20\d{2}\b/);
  if (yearMatch) {
    intent.year = parseInt(yearMatch[0]);
  }

  // ===== KEYWORDS (GIỮ NGUYÊN) =====
  if (q.includes("ai")) intent.keywords.push("ai");
  if (q.includes("y tế") || q.includes("health")) intent.keywords.push("health");
  if (q.includes("giáo dục")) intent.keywords.push("education");
  if (q.includes("cơ bản")) intent.keywords.push("basic research");

  // ================= 🔥 ADD (KHÔNG PHÁ LOGIC) =================
  if (q.includes("cơ bản") && (q.includes("việt") || q.includes("vietnam"))) {
    intent.keywords.push("nafosted");
  }

  return intent;
}

// ================= QUERY REWRITE =================
export function rewriteQuery(query, intent) {
  let expanded = query.toLowerCase();

  if (intent.country === "vietnam") {
    expanded += " vietnam nafosted";
  }

  if (intent.country === "usa") {
    expanded += " usa nsf";
  }

  return expanded;
}