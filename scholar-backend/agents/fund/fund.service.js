// agents/fund/fund.service.js

import { runFundSearch } from "./fund.agent.js";

import {
  normalizeHistory
} from "../shared/memory.js";

import {
  rewriteQuery
} from "../shared/queryRewriter.js";


// =====================================================
// CONFIG
// =====================================================

const MAX_RETURN = 5;


// =====================================================
// TEXT UTILS
// =====================================================

function normalizeText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeLower(value) {
  return normalizeText(value)
    .toLowerCase();
}


function fundSearchText(fund) {
  return normalizeLower(
    [
      fund?.title,
      fund?.agency,
      fund?.text
    ]
      .filter(Boolean)
      .join(" ")
  );
}


// =====================================================
// AMOUNT
// =====================================================

function parseAmount(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }

  const text =
    normalizeLower(value)
      .replace(/,/g, "");

  if (!text) {
    return 0;
  }

  const match =
    text.match(/\d+(?:\.\d+)?/);

  if (!match) {
    return 0;
  }

  const number =
    Number(match[0]);

  if (!Number.isFinite(number)) {
    return 0;
  }

  if (
    /\b(billion|bn)\b/.test(text)
  ) {
    return number * 1e9;
  }

  if (
    /\b(million|mn)\b/.test(text) ||
    /\d+(?:\.\d+)?m\b/.test(text)
  ) {
    return number * 1e6;
  }

  if (
    /\b(thousand)\b/.test(text) ||
    /\d+(?:\.\d+)?k\b/.test(text)
  ) {
    return number * 1e3;
  }

  return number;
}


function formatMoney(
  amount,
  amountNum
) {
  const raw =
    normalizeText(amount);

  /*
   * Nếu DB đã có chuỗi tiền tệ rõ ràng thì
   * giữ nguyên để không tự suy diễn đơn vị.
   */
  if (
    raw &&
    /[$€£¥₫]|usd|eur|gbp|vnd|đồng|dollar/i.test(raw)
  ) {
    return raw;
  }

  const num =
    Number(amountNum) ||
    parseAmount(amount);

  if (!num) {
    return raw;
  }

  return num.toLocaleString("en-US");
}


// =====================================================
// NORMALIZE FUND
// =====================================================

function normalizeFund(
  result,
  index
) {
  const payload =
    result?.payload ||
    result ||
    {};

  const amount =
    payload.funding_amount ??
    payload.amount ??
    "";

  const amountNum =
    Number(payload.amount_num) ||
    parseAmount(amount);

  const rawScore =
    Number(
      result?.finalScore ??
      result?.score ??
      0
    );

  const score =
    Number.isFinite(rawScore)
      ? Math.max(
          0,
          Math.min(
            1,
            rawScore
          )
        )
      : 0;

  return {

    title:
      normalizeText(
        payload.opportunity_title ||
        payload.title
      ),

    agency:
      normalizeText(
        payload.agency_name ||
        payload.agency
      ),

    deadline:
      normalizeText(
        payload.close_date ||
        payload.deadline
      ),

    amount,

    amount_num:
      amountNum,

    url:
      normalizeText(
        payload.url ||
        payload.link ||
        payload.additional_info_url ||
        payload["LINK TO ADDITIONAL INFORMATION"] ||
        payload["OPPORTUNITY URL"]
      ),

    text:
      normalizeText(
        payload.text ||
        payload.description
      ),

    score,

    _idx:
      index
  };
}


function normalizeFunds(results) {
  if (!Array.isArray(results)) {
    return [];
  }

  return results.map(
    normalizeFund
  );
}


// =====================================================
// QUERY INTENT
// =====================================================

function isVietnamQuery(question) {
  const q =
    normalizeLower(question);

  return (
    q.includes("việt") ||
    q.includes("vietnam") ||
    q.includes("nafosted")
  );
}


function isBasicResearchQuery(question) {
  const q =
    normalizeLower(question);

  return (
    q.includes("nghiên cứu cơ bản") ||
    q.includes("cơ bản") ||
    q.includes("basic research") ||
    q.includes("basic")
  );
}


function isNafostedFund(fund) {
  const text =
    fundSearchText(fund);

  return (
    text.includes("nafosted") ||
    text.includes(
      "quỹ phát triển khoa học"
    ) ||
    text.includes(
      "khoa học và công nghệ quốc gia"
    )
  );
}


function isVietnamFund(fund) {
  const text =
    fundSearchText(fund);

  return (
    text.includes("vietnam") ||
    text.includes("việt nam") ||
    text.includes("việt") ||
    isNafostedFund(fund)
  );
}


// =====================================================
// DEADLINE
// =====================================================

function safeTime(value) {
  if (!value) {
    return null;
  }

  const time =
    new Date(value).getTime();

  return Number.isFinite(time)
    ? time
    : null;
}


function getDeadlineInfo(deadline) {
  const time =
    safeTime(deadline);

  if (time === null) {
    return "";
  }

  const diffDays =
    (time - Date.now()) /
    86_400_000;

  if (diffDays < 0) {
    return "đã hết hạn";
  }

  if (diffDays <= 7) {
    return "deadline rất gần";
  }

  if (diffDays <= 30) {
    return "deadline sắp tới";
  }

  return "";
}


// =====================================================
// RELEVANCE
// =====================================================

function relevanceScore(
  fund,
  question
) {
  const q =
    normalizeLower(question);

  const text =
    fundSearchText(fund);

  let relevance = 0;


  // ---------------------------------------------------
  // Vietnam / NAFOSTED
  // ---------------------------------------------------

  if (isVietnamQuery(q)) {

    if (isNafostedFund(fund)) {
      relevance += 10;
    }

    if (
      text.includes("vietnam") ||
      text.includes("việt nam") ||
      text.includes("việt")
    ) {
      relevance += 3;
    }
  }


  if (
    q.includes("nafosted") &&
    isNafostedFund(fund)
  ) {
    relevance += 8;
  }


  // ---------------------------------------------------
  // Basic research
  // ---------------------------------------------------

  if (
    isBasicResearchQuery(q)
  ) {

    if (
      text.includes("basic research") ||
      text.includes("nghiên cứu cơ bản")
    ) {
      relevance += 5;
    }

    /*
     * Với câu hỏi nghiên cứu cơ bản nói chung,
     * bilateral/collaboration không nên tự động
     * được ưu tiên.
     */
    if (
      text.includes("bilateral") ||
      text.includes("collaboration") ||
      text.includes("joint research") ||
      text.includes("hợp tác")
    ) {
      relevance -= 2;
    }
  }


  // ---------------------------------------------------
  // Deadline
  // ---------------------------------------------------

  const deadline =
    safeTime(fund?.deadline);

  if (deadline !== null) {

    const year =
      new Date(deadline)
        .getFullYear();

    if (year < 2022) {
      relevance -= 2;
    }

    if (
      deadline >
      Date.now()
    ) {
      relevance += 1;
    }
  }


  return relevance;
}


// =====================================================
// HARD FILTER
// =====================================================

function applyHardFilters(
  funds,
  question
) {
  if (!funds.length) {
    return [];
  }

  /*
   * HARD FILTER:
   *
   * Khi standalone query yêu cầu Việt Nam/NAFOSTED,
   * tuyệt đối không fallback sang quỹ Mỹ hoặc
   * quốc gia khác chỉ vì vector similarity cao.
   */
  if (
    isVietnamQuery(question)
  ) {
    return funds.filter(
      isVietnamFund
    );
  }

  return funds;
}


// =====================================================
// RANKING
// =====================================================

function rankFunds(
  funds,
  question
) {
  return [...funds]
    .map(fund => ({
      ...fund,

      _relevance:
        relevanceScore(
          fund,
          question
        )
    }))
    .sort((a, b) => {

      // 1. Intent relevance
      if (
        b._relevance !==
        a._relevance
      ) {
        return (
          b._relevance -
          a._relevance
        );
      }


      // 2. Vector/final score
      if (
        b.score !==
        a.score
      ) {
        return (
          b.score -
          a.score
        );
      }


      // 3. Funding amount
      if (
        b.amount_num !==
        a.amount_num
      ) {
        return (
          b.amount_num -
          a.amount_num
        );
      }


      // 4. Stable original order
      return (
        a._idx -
        b._idx
      );
    });
}


// =====================================================
// REASONING
// =====================================================

function buildReasoning(
  fund,
  index,
  question
) {
  const reasons = [];


  if (
    relevanceScore(
      fund,
      question
    ) > 0
  ) {
    reasons.push(
      "khớp trực tiếp với yêu cầu"
    );
  }


  const deadlineInfo =
    getDeadlineInfo(
      fund.deadline
    );

  if (deadlineInfo) {
    reasons.push(
      deadlineInfo
    );
  }


  /*
   * Không tự gọi kết quả đầu tiên là
   * "phù hợp nhất với nhu cầu".
   *
   * Thứ tự đã được ranking xác định,
   * nhưng không cần đưa ra khẳng định
   * định tính quá mạnh trong phần render.
   */
  return reasons.length
    ? `👉 ${reasons.join(", ")}`
    : "";
}


// =====================================================
// RENDER
// =====================================================

function renderFund(
  fund,
  index,
  question
) {
  const lines = [];


  if (fund.title) {
    lines.push(
      `🎓 **${fund.title}**`
    );
  }


  if (fund.agency) {
    lines.push(
      `🏢 ${fund.agency}`
    );
  }


  const money =
    formatMoney(
      fund.amount,
      fund.amount_num
    );


  if (money) {
    lines.push(
      `💰 ${money}`
    );
  }


  if (fund.deadline) {
    lines.push(
      `📅 ${fund.deadline}`
    );
  }


  if (
    fund.url &&
    /^https?:\/\//i.test(
      fund.url
    )
  ) {
    lines.push(
      `🔎 ${fund.url}`
    );
  }


  const reason =
    buildReasoning(
      fund,
      index,
      question
    );


  if (reason) {
    lines.push(
      reason
    );
  }


  return lines.join("\n");
}


// =====================================================
// INTRO
// =====================================================

function buildIntro(question) {
  const q =
    normalizeLower(question);


  if (
    q.includes("nafosted")
  ) {
    return (
      "Các kết quả đầu tiên có liên quan trực tiếp " +
      "đến NAFOSTED theo dữ liệu hiện có."
    );
  }


  if (
    isVietnamQuery(q)
  ) {
    return (
      "Các kết quả sau liên quan đến Việt Nam " +
      "theo dữ liệu hiện có."
    );
  }


  if (
    q.includes("ai") ||
    q.includes("trí tuệ nhân tạo") ||
    q.includes("data") ||
    q.includes("dữ liệu")
  ) {
    return (
      "Các cơ hội sau được sắp xếp theo mức độ " +
      "liên quan với hướng nghiên cứu được yêu cầu."
    );
  }


  return (
    "Các cơ hội sau được sắp xếp theo mức độ " +
    "liên quan với yêu cầu."
  );
}


// =====================================================
// ANSWER
// =====================================================

function buildAnswer(
  funds,
  question
) {
  if (!funds.length) {

    if (
      isVietnamQuery(question)
    ) {
      return (
        "Không tìm thấy cơ hội tài trợ liên quan " +
        "đến Việt Nam phù hợp với yêu cầu trong dữ liệu hiện có."
      );
    }

    return (
      "Không tìm thấy quỹ phù hợp với yêu cầu trong dữ liệu hiện có."
    );
  }


  const lines = [
    buildIntro(question),
    "",
    renderFund(
      funds[0],
      0,
      question
    )
  ];


  funds
    .slice(1)
    .forEach(
      (fund, index) => {
        lines.push(
          "",
          "---",
          "",
          renderFund(
            fund,
            index + 1,
            question
          )
        );
      }
    );


  return lines
    .filter(
      value =>
        value !== undefined &&
        value !== null
    )
    .join("\n")
    .trim();
}


// =====================================================
// MAIN
// =====================================================

export async function runFundAgent(
  req,
  question,
  model_id,
  topk = MAX_RETURN,
  history = []
) {
  const start =
    Date.now();


  try {

    // ===================================================
    // 1. NORMALIZE HISTORY
    //
    // Portal context.history là nguồn hội thoại chính.
    // Không sử dụng express-session history trong Fund.
    // ===================================================

    const normalizedHistory =
      normalizeHistory(history);


    console.log(
      "\n========== FUND AGENT =========="
    );

    console.log(
      "🧠 HISTORY ITEMS:",
      normalizedHistory.length
    );

    console.log(
      "💬 ORIGINAL QUESTION:",
      question
    );

    console.log(
      "🤖 MODEL:",
      model_id ||
      "(none)"
    );


    // ===================================================
    // 2. CONTEXTUAL QUERY REWRITE
    //
    // Ví dụ:
    //
    // History:
    //   User: Tìm quỹ tài trợ AI tại Việt Nam
    //
    // Current:
    //   Còn của Mỹ?
    //
    // Standalone:
    //   Tìm quỹ tài trợ AI tại Mỹ
    //
    // standaloneQuestion được dùng cho:
    // - retrieval
    // - intent detection
    // - hard filter
    // - ranking
    // - deterministic answer
    // ===================================================

    let standaloneQuestion =
      normalizeText(question);


    try {

      const rewritten =
        await rewriteQuery(
          question,
          normalizedHistory
        );


      if (
        typeof rewritten === "string" &&
        rewritten.trim()
      ) {
        standaloneQuestion =
          rewritten.trim();
      }

    } catch (err) {

      console.warn(
        "⚠️ FUND QUERY REWRITE FAILED:",
        err?.message || err
      );

      standaloneQuestion =
        normalizeText(question);
    }


    console.log(
      "🔄 STANDALONE QUESTION:",
      standaloneQuestion
    );


    // ===================================================
    // 3. TOPK
    // ===================================================

    const finalTopk =
      Math.min(
        Math.max(
          Number(topk) ||
          MAX_RETURN,
          1
        ),
        MAX_RETURN
      );


    console.log(
      "🔢 TOPK:",
      finalTopk
    );

    console.log(
      "================================\n"
    );


    // ===================================================
    // 4. RETRIEVAL
    //
    // QUAN TRỌNG:
    // Search bằng standaloneQuestion.
    // ===================================================

    const raw =
      await runFundSearch(
        standaloneQuestion,
        model_id,
        finalTopk
      );


    console.log(
      "📊 FUND SEARCH:",
      Array.isArray(raw)
        ? raw.length
        : 0
    );


    // ===================================================
    // 5. NORMALIZE
    // ===================================================

    let funds =
      normalizeFunds(raw);


    // ===================================================
    // 6. HARD FILTERS
    //
    // QUAN TRỌNG:
    // Intent phải đọc standaloneQuestion,
    // không đọc câu follow-up thiếu ngữ cảnh.
    // ===================================================

    funds =
      applyHardFilters(
        funds,
        standaloneQuestion
      );


    console.log(
      "🌏 AFTER HARD FILTER:",
      funds.length
    );


    // ===================================================
    // 7. RANKING
    //
    // Ranking cũng dùng standaloneQuestion.
    // ===================================================

    funds =
      rankFunds(
        funds,
        standaloneQuestion
      )
        .slice(
          0,
          MAX_RETURN
        );


    console.log(
      "📦 FINAL FUNDS:",
      funds.length
    );


    // ===================================================
    // 8. ANSWER
    //
    // Fund hiện tại là deterministic.
    //
    // Vì vậy answer nên dùng standaloneQuestion để
    // buildIntro / reasoning hiểu đầy đủ intent.
    //
    // Nếu sau này Fund dùng buildFundPrompt + LLM,
    // generation LLM phải nhận question GỐC + history.
    // ===================================================

    const answer =
      buildAnswer(
        funds,
        standaloneQuestion
      );


    // ===================================================
    // 9. RESPONSE
    //
    // Không addToHistory().
    // Portal context.history là nguồn memory chính.
    // ===================================================

    return {

      answer,

      funds,

      domain:
        "fund",

      /*
       * Fund service hiện deterministic sau retrieval.
       * Không khai báo latency/token LLM giả.
       */
      model: {

        model_id:
          model_id ||
          null,

        model:
          null,

        latency:
          null,

        prompt_tokens:
          null,

        output_tokens:
          null
      },

      responseTimeMs:
        Date.now() - start
    };


  } catch (err) {

    console.error(
      "❌ Fund agent error:",
      err
    );


    return {

      answer:
        "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",

      funds:
        [],

      domain:
        "error",

      model: {

        model_id:
          model_id ||
          null,

        model:
          null,

        latency:
          null,

        prompt_tokens:
          null,

        output_tokens:
          null
      },

      responseTimeMs:
        Date.now() - start
    };
  }
}