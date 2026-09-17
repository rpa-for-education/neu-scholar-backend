// agents/fund/fund.agent.js

import { searchFund } from "./fund.search.js";
import { rankFunds } from "./fund.ranking.js";
import {
  detectIntent,
  rewriteQuery
} from "./agentReasoning.js";


// =====================================================
// CONFIG
// =====================================================

const CACHE = new Map();

const CACHE_TTL_MS =
  3 * 60 * 1000;

const CACHE_VERSION =
  "v17";

const MAX_TOPK = 5;

const SEARCH_MULTIPLIER = 3;


// =====================================================
// CACHE
// =====================================================

function getCache(key) {
  const item =
    CACHE.get(key);

  if (!item) {
    return null;
  }

  if (
    Date.now() - item.time >
    CACHE_TTL_MS
  ) {
    CACHE.delete(key);
    return null;
  }

  return item.value;
}


function setCache(
  key,
  value
) {
  CACHE.set(key, {
    time: Date.now(),
    value
  });

  /**
   * Opportunistic cleanup.
   */
  if (CACHE.size > 200) {
    const now =
      Date.now();

    for (
      const [cacheKey, item]
      of CACHE
    ) {
      if (
        now - item.time >
        CACHE_TTL_MS
      ) {
        CACHE.delete(cacheKey);
      }
    }
  }
}


// =====================================================
// UTILS
// =====================================================

function normalizeText(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}


function safeTopk(value) {
  const n =
    Number(value);

  if (
    !Number.isFinite(n) ||
    n <= 0
  ) {
    return MAX_TOPK;
  }

  return Math.min(
    Math.floor(n),
    MAX_TOPK
  );
}


function clampScore(value) {
  const n =
    Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(1, n)
  );
}


// =====================================================
// FUND TEXT
// =====================================================

function getFundText(item) {
  const payload =
    item?.payload || item || {};

  return normalizeText([
    payload.opportunity_title,
    payload.title,
    payload.description,
    payload.text,
    payload.agency_name,
    payload.agency
  ]
    .filter(Boolean)
    .join(" "));
}


// =====================================================
// VIETNAM
// =====================================================

function isVietnamRelated(item) {
  const text =
    getFundText(item);

  return (
    text.includes("vietnam") ||
    text.includes("việt nam") ||
    text.includes("việt") ||
    text.includes("nafosted") ||
    text.includes(
      "quỹ phát triển khoa học"
    ) ||
    text.includes(
      "khoa học và công nghệ quốc gia"
    )
  );
}


// =====================================================
// INTENT BOOST
// =====================================================

function getIntentBonus(
  item,
  intent
) {
  let bonus = 0;

  if (
    intent?.country === "vietnam" &&
    isVietnamRelated(item)
  ) {
    bonus += 0.15;
  }

  return bonus;
}


// =====================================================
// EXPLAIN
// =====================================================

function explainFund(
  item,
  query
) {
  const q =
    normalizeText(query);

  const text =
    getFundText(item);

  const reasons = [];

  if (
    Number(
      item?.explain?.semantic
    ) > 0.6
  ) {
    reasons.push(
      "liên quan nội dung tốt"
    );
  }

  /**
   * Không gọi funding là "cao"
   * chỉ từ một score nội bộ.
   *
   * Funding có thể được dùng trong ranking,
   * nhưng explanation không nên biến score
   * thành một khẳng định định tính.
   */

  if (
    Number(
      item?.explain?.deadline
    ) > 0.7
  ) {
    reasons.push(
      "deadline đáng lưu ý"
    );
  }

  if (
    q.includes("nafosted") &&
    (
      text.includes("nafosted") ||
      text.includes(
        "quỹ phát triển khoa học"
      ) ||
      text.includes(
        "khoa học và công nghệ quốc gia"
      )
    )
  ) {
    reasons.push(
      "đúng nhóm NAFOSTED"
    );
  }

  if (
    (
      q.includes("việt") ||
      q.includes("vietnam")
    ) &&
    isVietnamRelated(item)
  ) {
    reasons.push(
      "liên quan Việt Nam"
    );
  }

  if (!reasons.length) {
    reasons.push(
      "phù hợp tương đối với yêu cầu"
    );
  }

  return reasons.join(", ");
}


// =====================================================
// MAIN
// =====================================================

export async function runFundSearch(
  query,
  model_id,
  topk = MAX_TOPK
) {
  const start =
    Date.now();

  const q =
    normalizeText(query);

  if (!q) {
    return [];
  }

  const k =
    safeTopk(topk);

  // -------------------------------------------------
  // 1. Intent
  // -------------------------------------------------

  const intent =
    detectIntent(q) || {};

  // -------------------------------------------------
  // 2. Query rewrite
  //
  // Giữ rewriteQuery hiện tại.
  // Nếu đây là deterministic rewrite thì rất nhanh.
  // -------------------------------------------------

  const rewritten =
    rewriteQuery(
      q,
      intent
    );

  const expanded =
    normalizeText(
      rewritten || q
    ) || q;

  console.log(
    "\n========== FUND SEARCH =========="
  );

  console.log(
    "🔎 QUERY:",
    q
  );

  console.log(
    "🧭 INTENT:",
    intent
  );

  console.log(
    "✏️ EXPANDED:",
    expanded
  );

  console.log(
    "🔢 TOPK:",
    k
  );

  // -------------------------------------------------
  // 3. Cache
  // -------------------------------------------------

  const cacheKey = [
    CACHE_VERSION,
    expanded,
    String(k)
  ].join(":");

  const cached =
    getCache(cacheKey);

  if (cached) {
    console.log(
      "⚡ FUND CACHE HIT:",
      cached.length
    );

    return cached;
  }

  try {
    // -----------------------------------------------
    // 4. Vector retrieval
    // -----------------------------------------------

    const searchLimit =
      k * SEARCH_MULTIPLIER;

    let results =
      await searchFund(
        expanded,
        searchLimit
      ).catch(err => {
        console.error(
          "❌ Fund vector search error:",
          err?.message || err
        );

        return [];
      });

    if (
      !Array.isArray(results) ||
      !results.length
    ) {
      console.log(
        "📭 FUND SEARCH: 0 results"
      );

      return [];
    }

    console.log(
      "📥 RETRIEVED:",
      results.length
    );

    // -----------------------------------------------
    // 5. Normalize vector score
    // -----------------------------------------------

    results =
      results.map(
        (item, index) => ({
          ...item,

          score:
            clampScore(
              item?.score
            ),

          _retrievalIndex:
            index
        })
      );

    // -----------------------------------------------
    // 6. Deterministic ranking
    // -----------------------------------------------

    let ranked =
      rankFunds(
        results,
        q
      );

    if (!Array.isArray(ranked)) {
      ranked = [];
    }

    // -----------------------------------------------
    // 7. Intent boost
    // -----------------------------------------------

    let adjusted =
      ranked.map(item => {
        const baseScore =
          Number(
            item?.finalScore
          );

        const safeBaseScore =
          Number.isFinite(baseScore)
            ? baseScore
            : clampScore(
                item?.score
              );

        const bonus =
          getIntentBonus(
            item,
            intent
          );

        return {
          ...item,

          finalScore:
            safeBaseScore +
            bonus,

          intentBonus:
            bonus
        };
      });

    // -----------------------------------------------
    // 8. Stable final sort
    // -----------------------------------------------

    adjusted.sort(
      (a, b) => {
        const scoreDiff =
          Number(
            b?.finalScore || 0
          ) -
          Number(
            a?.finalScore || 0
          );

        if (scoreDiff !== 0) {
          return scoreDiff;
        }

        return (
          Number(
            a?._retrievalIndex || 0
          ) -
          Number(
            b?._retrievalIndex || 0
          )
        );
      }
    );

    // -----------------------------------------------
    // 9. Top K
    //
    // Không hard-filter ở đây.
    //
    // fund.service.js là tầng chịu trách nhiệm
    // hard-filter theo country/domain.
    //
    // Như vậy chỉ có MỘT nơi quyết định loại kết quả.
    // -----------------------------------------------

    let finalResults =
      adjusted.slice(
        0,
        k
      );

    // -----------------------------------------------
    // 10. Explain
    // -----------------------------------------------

    finalResults =
      finalResults.map(
        item => ({
          ...item,

          explainText:
            explainFund(
              item,
              q
            )
        })
      );

    // -----------------------------------------------
    // 11. Cache
    // -----------------------------------------------

    setCache(
      cacheKey,
      finalResults
    );

    console.log(
      "📤 FINAL RESULTS:",
      finalResults.length
    );

    console.log(
      "⏱️ FUND SEARCH TIME:",
      Date.now() - start,
      "ms"
    );

    console.log(
      "=================================\n"
    );

    return finalResults;

  } catch (err) {
    console.error(
      "❌ Fund agent error:",
      err
    );

    return [];
  }
}