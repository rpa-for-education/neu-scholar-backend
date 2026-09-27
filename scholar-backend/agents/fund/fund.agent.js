// agents/fund/fund.agent.js
import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import {
  detectIntent,
  rewriteQuery
} from "./agentReasoning.js";

const CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_TOPK = 5;
const SEARCH_MULTIPLIER = 3;

function text(value) {
  return String(value ?? "").trim();
}
function normalize(value) {
  return text(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function safeTopk(value) {
  return Math.min(
    MAX_TOPK,
    Math.max(
      1,
      Math.trunc(Number(value)) || MAX_TOPK
    )
  );
}
function titleOf(item) {
  const payload = item?.payload || item || {};
  return text(
    payload.opportunity_title ||
    payload.title ||
    payload.name ||
    payload.program_title ||
    payload.opportunity_name
  );
}
function namedMatch(item, question) {
  const title = normalize(titleOf(item));
  return title.length >= 8 &&
    normalize(question).includes(title);
}
function identity(item) {
  const payload = item?.payload || item || {};
  return normalize(
    payload.opportunity_id ||
    payload.opportunity_number ||
    payload.u_key ||
    `${titleOf(item)}|${
      payload.agency_name ||
      payload.agency ||
      ""
    }`
  );
}
function dedupe(items) {
  const found = new Map();

  for (const item of items) {
    const key = identity(item);
    if (!key || !titleOf(item)) continue;

    const previous = found.get(key);
    if (
      !previous ||
      Number(item.score || 0) >
        Number(previous.score || 0)
    ) {
      found.set(key, item);
    }
  }
  return [...found.values()];
}
function cacheGet(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;

  if (
    Date.now() - entry.time >=
    CACHE_TTL_MS
  ) {
    CACHE.delete(key);
    return null;
  }
  return entry.value;
}
function cacheSet(key, value) {
  CACHE.set(key, {
    value,
    time: Date.now()
  });

  while (CACHE.size > 500) {
    CACHE.delete(
      CACHE.keys().next().value
    );
  }
}
function explainText(item, question) {
  const reasons = [];
  const payload = item.payload || {};

  if (namedMatch(item, question)) {
    reasons.push(
      "trùng tên chương trình được hỏi"
    );
  }

  const relevance =
    Number(item.explain?.text) || 0;

  if (relevance >= 0.5) {
    reasons.push(
      "nội dung liên quan đến câu hỏi"
    );
  }

  const deadline =
    payload.close_date ||
    payload.deadline;

  if (deadline) {
    const date =
      new Date(deadline).getTime();

    if (
      Number.isFinite(date) &&
      date >= Date.now()
    ) {
      reasons.push(
        "hạn nộp chưa qua theo dữ liệu hiện có"
      );
    }
  }

  return reasons.join("; ");
}

export async function runFundSearch(
  query,
  model_id,
  topk = MAX_TOPK
) {
  const question = text(query);
  if (!question) return [];

  const k = safeTopk(topk);
  const intent =
    detectIntent(question) || {};
  const expanded =
    text(rewriteQuery(question, intent)) ||
    question;

  const cacheKey =
    `${normalize(expanded)}|${k}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const retrieved = await searchFund(
      expanded,
      Math.min(
        k * SEARCH_MULTIPLIER,
        50
      )
    );
    if (
      !Array.isArray(retrieved) ||
      !retrieved.length
    ) {
      return [];
    }

    const unique = dedupe(retrieved);
    const ranked = rankFunds(
      unique,
      question
    );

    const ordered = ranked.map(
      (item, index) => ({
        ...item,
        _retrievalIndex: index,
        finalScore:
          (Number(item.finalScore) || 0) +
          (
            namedMatch(item, question)
              ? 0.25
              : 0
          )
      })
    );

    ordered.sort(
      (a, b) =>
        b.finalScore - a.finalScore ||
        a._retrievalIndex -
          b._retrievalIndex
    );

    const results = ordered
      .slice(0, k)
      .map(item => ({
        ...item,
        explainText: explainText(
          item,
          question
        )
      }));

    cacheSet(
      cacheKey,
      results
    );
    return results;
  } catch (error) {
    console.error(
      "❌ Fund search agent error:",
      error?.message || error
    );
    return [];
  }
}