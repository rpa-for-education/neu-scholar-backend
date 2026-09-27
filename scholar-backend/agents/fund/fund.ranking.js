// agents/fund/fund.ranking.js
function normalize(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map(normalize).filter(Boolean).join(" ");
  }
  if (typeof value === "object") {
    return Object.values(value).map(normalize).filter(Boolean).join(" ");
  }
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function number(value) {
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : 0;
}
function parseAmount(value) {
  if (typeof value === "number") return number(value);
  const raw = String(value ?? "").trim();
  if (!raw || /\b(per|month|day|year|hour)\b/i.test(raw)) {
    return 0;
  }

  const match = raw.match(
    /(\d[\d.,\s]*)(?:\s*)(billion|bn|million|mn|thousand|ty|tỷ|trieu|triệu|nghin|nghìn|[bmk])?\b/i
  );
  if (!match) return 0;

  let digits = match[1].replace(/\s/g, "");
  const unit = normalize(match[2]);

  if (
    !unit &&
    /^\d{1,3}(?:[.,]\d{3})+$/.test(digits)
  ) {
    digits = digits.replace(/[.,]/g, "");
  } else if (
    digits.includes(",") &&
    digits.includes(".")
  ) {
    digits = digits.replace(/,/g, "");
  } else if (
    /^\d{1,3}(?:,\d{3})+$/.test(digits)
  ) {
    digits = digits.replace(/,/g, "");
  } else {
    digits = digits.replace(",", ".");
  }

  const amount = Number(digits);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (["billion", "bn", "b", "ty"].includes(unit)) {
    return amount * 1e9;
  }
  if (["million", "mn", "m", "trieu"].includes(unit)) {
    return amount * 1e6;
  }
  if (["thousand", "k", "nghin"].includes(unit)) {
    return amount * 1e3;
  }
  return amount;
}
function parseDeadline(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  // Ngày không có giờ được tính đến cuối ngày.
  const dateText = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T23:59:59Z`
    : raw;
  const time = new Date(dateText).getTime();
  return Number.isFinite(time) ? time : null;
}
function fundingScore(amount) {
  if (!amount) return 0;
  return Math.min(1, Math.log10(amount + 1) / 10);
}
function deadlineScore(deadline) {
  const time = parseDeadline(deadline);
  if (time === null) return 0;

  const days = (time - Date.now()) / 86400000;
  if (days < 0) return 0;
  if (days <= 7) return 0.9;
  if (days <= 30) return 1;
  if (days <= 90) return 0.8;
  return 0.6;
}
const STOP_WORDS = new Set([
  "toi", "cho", "tim", "kiem", "cac", "mot", "nhung",
  "cua", "voi", "trong", "ve", "the", "and",
  "for", "from", "this", "that", "fund", "quy"
]);
function tokens(value) {
  return [...new Set(
    normalize(value)
      .split(/\s+/)
      .filter(word =>
        word.length >= 3 && !STOP_WORDS.has(word)
      )
  )];
}
function textScore(payload, query) {
  const searchable = normalize([
    payload.title,
    payload.name,
    payload.agency,
    payload.text,
    payload.description,
    payload.summary,
    payload.keywords,
    payload.eligibility,
    payload.country
  ]);
  if (!searchable) return 0;

  const expanded = normalize(query)
    .replace(/viet nam/g, "vietnam");
  const words = tokens(expanded);
  if (!words.length) return 0;

  const matches = words.filter(word =>
    searchable.includes(word)
  ).length;
  let score = matches / words.length;
  const q = normalize(query);

  if (
    q.includes("nghien cuu co ban") &&
    searchable.includes("basic research")
  ) score += 0.15;

  if (
    q.includes("giao duc") &&
    searchable.includes("education")
  ) score += 0.15;

  if (
    (q.includes("y te") || q.includes("suc khoe")) &&
    searchable.includes("health")
  ) score += 0.15;

  if (
    /(^| )nafosted( |$)/.test(q) &&
    searchable.includes("nafosted")
  ) score += 0.25;

  return Math.min(1, Math.max(0, score));
}
function yearScore(payload, query) {
  const match = String(query ?? "").match(/\b20\d{2}\b/);
  if (!match) return 0;

  const year = match[0];
  const explicit = [
    payload.fiscal_year,
    payload.year,
    payload.call_year
  ]
    .filter(value => value != null)
    .map(String);

  if (explicit.includes(year)) return 0.05;

  const deadline = parseDeadline(payload.deadline);
  return deadline !== null &&
    String(new Date(deadline).getUTCFullYear()) === year
      ? 0.05
      : 0;
}

export function rankFunds(results, query = "") {
  if (!Array.isArray(results) || !results.length) {
    return [];
  }

  return results
    .map((result, index) => {
      const payload = result.payload || result;
      const storedAmount = number(payload.amount_num);
      const amount_num = storedAmount ||
        parseAmount(payload.amount);
      const semantic = Math.min(
        1,
        Math.max(
          0,
          Number(
            result.score ?? result.baseScore ?? 0
          ) || 0
        )
      );
      const text = textScore(payload, query);
      const funding = fundingScore(amount_num);
      const deadline = deadlineScore(payload.deadline);

      const finalScore = Math.min(
        1,
        0.6 * semantic +
        0.25 * text +
        0.05 * funding +
        0.1 * deadline +
        yearScore(payload, query)
      );

      return {
        ...result,
        finalScore,
        amount_num,
        explain: {
          semantic,
          funding,
          deadline,
          text
        },
        _idx: index
      };
    })
    .sort((a, b) =>
      b.finalScore - a.finalScore ||
      a._idx - b._idx
    );
}