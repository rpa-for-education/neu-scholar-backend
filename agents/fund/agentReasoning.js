// agentReasoning.js - INTENT + QUERY REASONING

export function detectIntent(query = "") {
  const q = query.toLowerCase();

  const intent = {
    country: null,
    year: null,
    keywords: [],
  };

  // COUNTRY
  if (q.includes("việt") || q.includes("vietnam")) {
    intent.country = "vietnam";
  }

  if (q.includes("mỹ") || q.includes("usa") || q.includes("united states")) {
    intent.country = "usa";
  }

  // YEAR
  const yearMatch = q.match(/\b20\d{2}\b/);
  if (yearMatch) {
    intent.year = parseInt(yearMatch[0]);
  }

  // KEYWORDS
  if (q.includes("ai")) intent.keywords.push("artificial intelligence");
  if (q.includes("y tế") || q.includes("health")) intent.keywords.push("health");
  if (q.includes("giáo dục")) intent.keywords.push("education");
  if (q.includes("cơ bản")) intent.keywords.push("basic research");

  return intent;
}

export function rewriteQuery(query, intent) {
  let expanded = query.toLowerCase();

  if (intent.country === "vietnam") {
    expanded += " vietnam nafosted vietnam-based funding";
  }

  if (intent.country === "usa") {
    expanded += " united states nsf federal funding";
  }

  if (intent.year) {
    expanded += ` ${intent.year} ${intent.year - 1}`;
  }

  if (intent.keywords.length) {
    expanded += " " + intent.keywords.join(" ");
  }

  return expanded;
}