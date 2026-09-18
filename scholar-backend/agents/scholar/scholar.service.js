// agents/scholar/scholar.service.js

import {
  runAgent
} from "./scholar.agent.js";

import {
  normalizeHistory
} from "../shared/memory.js";

import {
  buildLLMContext
} from "../shared/context.js";

import {
  rewriteQuery
} from "../shared/queryRewriter.js";

import {
  buildScholarPrompt
} from "./scholar.prompt.js";

import {
  callLLM
} from "../shared/llm.js";


// =====================================================
// BASIC HELPERS
// =====================================================

function hasValue(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "string") {
    const text =
      value
        .trim()
        .toLowerCase();

    return (
      text !== "" &&
      text !== "n/a" &&
      text !== "na" &&
      text !== "null" &&
      text !== "undefined"
    );
  }

  return true;
}


function firstValue(...values) {
  for (const value of values) {
    if (hasValue(value)) {
      return value;
    }
  }

  return "";
}


function normalizeText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replace(/\s+/g, " ")
    .trim();
}


function normalizeList(value) {
  if (!hasValue(value)) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (
          item === null ||
          item === undefined
        ) {
          return "";
        }

        if (
          typeof item === "object"
        ) {
          return Object.values(item)
            .filter(hasValue)
            .map(v => normalizeText(v))
            .filter(Boolean)
            .join(" ");
        }

        return normalizeText(item);
      })
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.values(value)
      .filter(hasValue)
      .map(v => normalizeText(v))
      .filter(Boolean);
  }

  const text =
    normalizeText(value);

  if (!text) {
    return [];
  }

  /*
   * Do not split by comma because commas may be part
   * of legitimate category/topic names.
   *
   * Common stored formats:
   *
   * "Education (Q1); Computer Science (Q1)"
   * "Education | Technology"
   */
  return text
    .split(/\s*[;|]\s*/)
    .map(v => v.trim())
    .filter(Boolean);
}


function normalizeQuartile(value) {
  if (!hasValue(value)) {
    return "";
  }

  const text =
    String(value)
      .toUpperCase()
      .trim();

  const match =
    text.match(
      /\bQ\s*([1-4])\b/i
    );

  return match
    ? `Q${match[1]}`
    : "";
}


function safeNumber(
  value,
  fallback = 0
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}


// =====================================================
// URL HELPERS
// =====================================================

function buildConferenceUrl(c = {}) {
  return normalizeText(
    firstValue(
      c?.cfp_link,
      c?.url,
      c?.link,
      c?.website,
      c?.conference_url,
      c?.homepage
    )
  );
}


function buildJournalUrl(j = {}) {
  return normalizeText(
    firstValue(
      j?.scimago_link,
      j?.url,
      j?.link,
      j?.website,
      j?.homepage
    )
  );
}


// =====================================================
// JOURNAL FIELD HELPERS
// =====================================================

function getJournalQuartile(j = {}) {
  /*
   * IMPORTANT:
   *
   * Only explicit journal-level quartile fields are
   * considered authoritative.
   *
   * DO NOT derive canonical quartile from categories
   * or areas here.
   *
   * Example:
   *
   * categories:
   *   "Education (Q1); Computer Science (Q2)"
   *
   * represents category-level quartiles and should
   * remain in metadata.categories.
   */
  const values = [
    j?.quartile,
    j?.sjr_best_quartile,
    j?.best_quartile,
    j?.sjr_quartile
  ];

  for (const value of values) {
    const quartile =
      normalizeQuartile(value);

    if (quartile) {
      return quartile;
    }
  }

  return "";
}


function getJournalPublisher(j = {}) {
  return normalizeText(
    firstValue(
      j?.publisher,
      j?.publisher_name,
      j?.publisher_alt
    )
  );
}


function getJournalCountry(j = {}) {
  return normalizeText(
    firstValue(
      j?.country,
      j?.country_name,
      j?.nation
    )
  );
}


function getJournalCategories(j = {}) {
  return normalizeList(
    firstValue(
      j?.categories,
      j?.category,
      j?.subjects,
      j?.subject
    )
  );
}


function getJournalAreas(j = {}) {
  return normalizeList(
    firstValue(
      j?.areas,
      j?.area,
      j?.research_areas,
      j?.research_area
    )
  );
}


function getJournalFields(j = {}) {
  return normalizeList(
    firstValue(
      j?.fields,
      j?.field
    )
  );
}


function getJournalIssn(j = {}) {
  return normalizeText(
    firstValue(
      j?.primary_issn,
      j?.issn
    )
  );
}


// =====================================================
// CONFERENCE FIELD HELPERS
// =====================================================

function getConferenceCountry(c = {}) {
  return normalizeText(
    firstValue(
      c?.country,
      c?.country_name,
      c?.location_country,
      c?.nation
    )
  );
}


function getConferenceCity(c = {}) {
  return normalizeText(
    firstValue(
      c?.city,
      c?.location_city
    )
  );
}


function getConferenceLocation(c = {}) {
  const explicit =
    normalizeText(
      c?.location
    );

  if (explicit) {
    return explicit;
  }

  return [
    getConferenceCity(c),
    getConferenceCountry(c)
  ]
    .filter(Boolean)
    .join(", ");
}


function getConferenceTopics(c = {}) {
  return normalizeList(
    firstValue(
      c?.topics,
      c?.topic,
      c?.categories,
      c?.category,
      c?.subjects,
      c?.subject,
      c?.keywords
    )
  );
}


function getConferenceFields(c = {}) {
  return normalizeList(
    firstValue(
      c?.fields,
      c?.field,
      c?.areas,
      c?.area
    )
  );
}


// =====================================================
// DATE HELPERS
// =====================================================

function safeTime(value) {
  if (!hasValue(value)) {
    return null;
  }

  const time =
    new Date(value)
      .getTime();

  return Number.isFinite(time)
    ? time
    : null;
}


// =====================================================
// CONFERENCE TEMPORAL STATUS
// =====================================================

function getConferenceStatus(c = {}) {
  /*
   * This is a COMPUTED temporal status.
   *
   * c.status is preserved separately as source_status.
   *
   * This distinction is important because source.status
   * may describe crawler/import state rather than the
   * actual temporal state of the conference.
   */

  const now =
    Date.now();

  const deadline =
    safeTime(
      firstValue(
        c?.deadline,
        c?.submission_deadline,
        c?.paper_deadline,
        c?.cfp_deadline
      )
    );

  const start =
    safeTime(
      firstValue(
        c?.start_date,
        c?.event_date,
        c?.conference_date
      )
    );

  const end =
    safeTime(
      firstValue(
        c?.end_date,
        c?.event_end_date
      )
    );


  // ---------------------------------------------------
  // DEADLINE AVAILABLE
  // ---------------------------------------------------

  if (deadline !== null) {
    const diffDays =
      (deadline - now) /
      (1000 * 60 * 60 * 24);

    if (diffDays > 30) {
      return "submission_open";
    }

    if (diffDays > 0) {
      return "submission_soon";
    }

    /*
     * Deadline has passed.
     * Conference may still be upcoming.
     */
    if (
      start !== null &&
      start > now
    ) {
      return "upcoming_event";
    }

    if (
      end !== null &&
      end >= now
    ) {
      return "ongoing_event";
    }

    if (
      start !== null &&
      start <= now
    ) {
      return "past_event";
    }

    return "submission_closed";
  }


  // ---------------------------------------------------
  // NO DEADLINE, BUT EVENT DATE AVAILABLE
  // ---------------------------------------------------

  if (
    start !== null &&
    start > now
  ) {
    return "upcoming_event";
  }

  if (
    end !== null &&
    end >= now
  ) {
    return "ongoing_event";
  }

  if (
    start !== null &&
    start <= now
  ) {
    return "past_event";
  }


  // ---------------------------------------------------
  // NO RELIABLE TEMPORAL DATA
  // ---------------------------------------------------

  return "unknown";
}


// =====================================================
// CONFERENCE SOURCE
// =====================================================

function buildConferenceSource(
  conference,
  index
) {
  const c =
    conference || {};

  const country =
    getConferenceCountry(c);

  const city =
    getConferenceCity(c);

  const location =
    getConferenceLocation(c);

  const topics =
    getConferenceTopics(c);

  const fields =
    getConferenceFields(c);

  const deadline =
    normalizeText(
      firstValue(
        c?.deadline,
        c?.submission_deadline,
        c?.paper_deadline,
        c?.cfp_deadline
      )
    );

  const startDate =
    normalizeText(
      firstValue(
        c?.start_date,
        c?.event_date,
        c?.conference_date
      )
    );

  const endDate =
    normalizeText(
      firstValue(
        c?.end_date,
        c?.event_end_date
      )
    );

  const metadata = {};


  if (hasValue(c?.acronym)) {
    metadata.acronym =
      normalizeText(c.acronym);
  }


  if (country) {
    metadata.country =
      country;
  }


  if (hasValue(c?.country_code)) {
    metadata.country_code =
      normalizeText(
        c.country_code
      );
  }


  if (hasValue(c?.continent)) {
    metadata.continent =
      normalizeText(
        c.continent
      );
  }


  if (city) {
    metadata.city =
      city;
  }


  if (location) {
    metadata.location =
      location;
  }


  if (deadline) {
    metadata.deadline =
      deadline;
  }


  if (startDate) {
    metadata.start_date =
      startDate;
  }


  if (endDate) {
    metadata.end_date =
      endDate;
  }


  /*
   * Preserve original source status separately.
   */
  if (hasValue(c?.status)) {
    metadata.source_status =
      normalizeText(
        c.status
      );
  }


  /*
   * Canonical temporal status calculated from dates.
   */
  metadata.conference_status =
    getConferenceStatus(c);


  if (fields.length) {
    metadata.fields =
      fields;
  }


  if (topics.length) {
    metadata.topics =
      topics;
  }


  if (hasValue(c?.cfp_text)) {
    metadata.cfp_text =
      normalizeText(
        c.cfp_text
      );
  }


  if (hasValue(c?.organizer)) {
    metadata.organizer =
      normalizeText(
        c.organizer
      );
  }


  if (hasValue(c?.source)) {
    metadata.source =
      normalizeText(
        c.source
      );
  }


  if (hasValue(c?.crawl_source)) {
    metadata.crawl_source =
      normalizeText(
        c.crawl_source
      );
  }


  if (
    c?.is_enriched !==
    undefined &&
    c?.is_enriched !==
    null
  ) {
    metadata.is_enriched =
      Boolean(
        c.is_enriched
      );
  }


  metadata.score =
    safeNumber(
      c?.finalScore ??
      c?.score ??
      c?.baseScore,
      0
    );


  return {
    id:
      `C${index + 1}`,

    type:
      "conference",

    title:
      normalizeText(
        firstValue(
          c?.name,
          c?.title,
          c?.conference_name,
          c?.event_name,
          c?.acronym
        )
      ) ||
      "Untitled conference",

    url:
      buildConferenceUrl(c),

    metadata
  };
}


// =====================================================
// JOURNAL SOURCE
// =====================================================

function buildJournalSource(
  journal,
  index
) {
  const j =
    journal || {};

  const quartile =
    getJournalQuartile(j);

  const publisher =
    getJournalPublisher(j);

  const country =
    getJournalCountry(j);

  const categories =
    getJournalCategories(j);

  const areas =
    getJournalAreas(j);

  const fields =
    getJournalFields(j);

  const issn =
    getJournalIssn(j);

  const metadata = {};


  // ---------------------------------------------------
  // QUARTILE
  // ---------------------------------------------------

  if (quartile) {
    metadata.quartile =
      quartile;
  }


  /*
   * Preserve original SJR best quartile separately.
   */
  if (
    hasValue(
      j?.sjr_best_quartile
    )
  ) {
    metadata.sjr_best_quartile =
      normalizeQuartile(
        j.sjr_best_quartile
      ) ||
      normalizeText(
        j.sjr_best_quartile
      );
  }


  // ---------------------------------------------------
  // PUBLISHER / LOCATION
  // ---------------------------------------------------

  if (publisher) {
    metadata.publisher =
      publisher;
  }


  if (
    hasValue(
      j?.publisher_alt
    )
  ) {
    metadata.publisher_alt =
      normalizeText(
        j.publisher_alt
      );
  }


  if (country) {
    metadata.country =
      country;
  }


  if (hasValue(j?.region)) {
    metadata.region =
      normalizeText(
        j.region
      );
  }


  // ---------------------------------------------------
  // SUBJECT INFORMATION
  // ---------------------------------------------------

  if (categories.length) {
    metadata.categories =
      categories;
  }


  if (areas.length) {
    metadata.areas =
      areas;
  }


  if (fields.length) {
    metadata.fields =
      fields;
  }


  // ---------------------------------------------------
  // IDENTIFIERS
  // ---------------------------------------------------

  if (issn) {
    metadata.issn =
      issn;
  }


  if (
    hasValue(
      j?.primary_issn
    )
  ) {
    metadata.primary_issn =
      normalizeText(
        j.primary_issn
      );
  }


  if (
    hasValue(
      j?.sourceid
    )
  ) {
    metadata.sourceid =
      normalizeText(
        j.sourceid
      );
  }


  // ---------------------------------------------------
  // METRICS
  // ---------------------------------------------------

  if (hasValue(j?.rank)) {
    metadata.rank =
      j.rank;
  }


  if (hasValue(j?.sjr)) {
    metadata.sjr =
      j.sjr;
  }


  if (
    hasValue(
      j?.h_index
    )
  ) {
    metadata.h_index =
      j.h_index;
  }


  if (
    hasValue(
      j?.total_docs_2024
    )
  ) {
    metadata.total_docs_2024 =
      j.total_docs_2024;
  }


  if (
    hasValue(
      j?.total_docs_3years
    )
  ) {
    metadata.total_docs_3years =
      j.total_docs_3years;
  }


  if (
    hasValue(
      j?.total_refs
    )
  ) {
    metadata.total_refs =
      j.total_refs;
  }


  if (
    hasValue(
      j?.total_cites_3years
    )
  ) {
    metadata.total_cites_3years =
      j.total_cites_3years;
  }


  if (
    hasValue(
      j?.citable_docs_3years
    )
  ) {
    metadata.citable_docs_3years =
      j.citable_docs_3years;
  }


  const citesPerDoc =
    firstValue(
      j?.cites_per_doc_2years,
      j?.citations_per_doc_2years,
      j?.citations_doc_2years
    );


  if (hasValue(citesPerDoc)) {
    metadata.cites_per_doc_2years =
      citesPerDoc;
  }


  const refsPerDoc =
    firstValue(
      j?.ref_per_doc,
      j?.refs_per_doc
    );


  if (hasValue(refsPerDoc)) {
    metadata.refs_per_doc =
      refsPerDoc;
  }


  if (
    hasValue(
      j?.female_percent
    )
  ) {
    metadata.female_percent =
      j.female_percent;
  }


  if (hasValue(j?.overton)) {
    metadata.overton =
      j.overton;
  }


  if (hasValue(j?.sdg)) {
    metadata.sdg =
      j.sdg;
  }


  // ---------------------------------------------------
  // TYPE / COVERAGE / OA
  // ---------------------------------------------------

  if (hasValue(j?.type)) {
    metadata.journal_type =
      normalizeText(
        j.type
      );
  }


  if (
    hasValue(
      j?.coverage
    )
  ) {
    metadata.coverage =
      normalizeText(
        j.coverage
      );
  }


  if (
    j?.open_access !==
    undefined &&
    j?.open_access !==
    null
  ) {
    metadata.open_access =
      Boolean(
        j.open_access
      );
  }


  if (
    j?.open_access_diamond !==
    undefined &&
    j?.open_access_diamond !==
    null
  ) {
    metadata.open_access_diamond =
      Boolean(
        j.open_access_diamond
      );
  }


  if (
    j?.vn_professor_council !==
    undefined &&
    j?.vn_professor_council !==
    null
  ) {
    metadata.vn_professor_council =
      Boolean(
        j.vn_professor_council
      );
  }


  // ---------------------------------------------------
  // SCORE
  // ---------------------------------------------------

  metadata.score =
    safeNumber(
      j?.finalScore ??
      j?.score ??
      j?.baseScore,
      0
    );


  return {
    id:
      `J${index + 1}`,

    type:
      "journal",

    title:
      normalizeText(
        firstValue(
          j?.title,
          j?.name,
          j?.journal_title,
          j?.source_title
        )
      ) ||
      "Untitled journal",

    url:
      buildJournalUrl(j),

    metadata
  };
}


// =====================================================
// FALLBACK ANSWER
// =====================================================

function buildFallbackAnswer({
  question,
  conferences,
  journals
}) {
  const conferenceCount =
    conferences.length;

  const journalCount =
    journals.length;

  const total =
    conferenceCount +
    journalCount;


  /*
   * IMPORTANT:
   *
   * This statement refers only to retrieved system
   * results. It must not claim that no such journal or
   * conference exists in the real world.
   */
  if (total === 0) {
    return (
      "Không tìm thấy kết quả phù hợp trong dữ liệu " +
      "được hệ thống truy xuất cho yêu cầu này."
    );
  }


  if (
    conferenceCount > 0 &&
    journalCount > 0
  ) {
    return (
      `Hệ thống truy xuất được ${total} kết quả liên quan ` +
      `đến yêu cầu "${question}", gồm ` +
      `${conferenceCount} hội thảo và ` +
      `${journalCount} tạp chí.`
    );
  }


  if (conferenceCount > 0) {
    return (
      `Hệ thống truy xuất được ${conferenceCount} ` +
      `hội thảo liên quan đến yêu cầu "${question}".`
    );
  }


  return (
    `Hệ thống truy xuất được ${journalCount} ` +
    `tạp chí liên quan đến yêu cầu "${question}".`
  );
}


// =====================================================
// SCHOLAR SERVICE
// =====================================================

export async function runScholarAgent(
  req,
  question,
  model_id,
  topk,
  history = []
) {
  const start =
    Date.now();


  try {
    // =================================================
    // 1. MEMORY / CONTEXT
    // =================================================

    const normalizedHistory =
      normalizeHistory(
        history
      );


    const llmContext =
      buildLLMContext(
        req
      ) || {};


    /*
     * Portal context.history is authoritative.
     *
     * Do not use express-session history here.
     */
    llmContext.history =
      normalizedHistory;


    console.log(
      "\n========== SCHOLAR AGENT =========="
    );


    console.log(
      "🧠 HISTORY ITEMS:",
      normalizedHistory.length
    );


    console.log(
      "👤 PROFILE:",
      llmContext.profile
        ?.full_name ||
      "(none)"
    );


    console.log(
      "📌 PROJECT:",
      llmContext.project
        ?.name ||
      "(none)"
    );


    console.log(
      "📄 DOCUMENTS:",
      Array.isArray(
        llmContext.docs
      )
        ? llmContext.docs.length
        : 0
    );


    console.log(
      "💬 ORIGINAL QUESTION:",
      question
    );


    console.log(
      "🤖 REQUESTED MODEL:",
      model_id ||
      "(default)"
    );


    // =================================================
    // 2. CONTEXTUAL QUERY REWRITE
    //
    // IMPORTANT:
    //
    // queryRewriter is SHARED by:
    //
    // - JOURNAL
    // - CONFERENCE
    // - FUND
    //
    // For Scholar this service only supplies:
    //
    // - current question
    // - normalized conversation history
    //
    // Profile/project/documents are intentionally NOT
    // passed into query rewriting.
    // =================================================

    let standaloneQuestion =
      normalizeText(
        question
      );


    /*
     * rewriteQuery already contains its own safe
     * fallback. This outer guard is kept as an
     * additional service-level protection.
     */
    try {
      const rewritten =
        await rewriteQuery(
          standaloneQuestion,
          normalizedHistory
        );


      if (
        typeof rewritten ===
          "string" &&
        rewritten.trim()
      ) {
        standaloneQuestion =
          normalizeText(
            rewritten
          );
      }

    } catch (error) {
      console.warn(
        "⚠️ QUERY REWRITE FAILED:",
        error?.message ||
        error
      );
    }


    if (!standaloneQuestion) {
      standaloneQuestion =
        normalizeText(
          question
        );
    }


    console.log(
      "🔄 STANDALONE QUESTION:",
      standaloneQuestion
    );


    console.log(
      "===================================\n"
    );


    // =================================================
    // 3. RETRIEVAL
    //
    // ONLY standaloneQuestion is used here.
    //
    // Example:
    //
    // Original:
    //   "Q2 thì sao?"
    //
    // Standalone:
    //   "Cho tôi tạp chí Q2 về công nghệ giáo dục"
    //
    // scholar.agent.js
    //        ↓
    // scholar.search.js
    //        ↓
    // Qdrant / hybrid retrieval
    // =================================================

    const result =
      await runAgent(
        standaloneQuestion,
        topk
      );


    const conferences =
      Array.isArray(
        result?.conferences
      )
        ? result.conferences
        : [];


    const journals =
      Array.isArray(
        result?.journals
      )
        ? result.journals
        : [];


    console.log(
      "📊 SEARCH:",
      conferences.length,
      journals.length
    );


    // =================================================
    // 4. BUILD SOURCES
    // =================================================

    const sources = [
      ...conferences.map(
        buildConferenceSource
      ),

      ...journals.map(
        buildJournalSource
      )
    ];


    console.log(
      "📦 SOURCES:",
      sources.length
    );


    // =================================================
    // 5. FINAL GENERATION PROMPT
    //
    // IMPORTANT:
    //
    // Use ORIGINAL question here.
    //
    // buildScholarPrompt receives:
    //
    // - original current question
    // - retrieved conferences
    // - retrieved journals
    // - profile
    // - project
    // - documents
    // - conversation history
    //
    // standaloneQuestion is a RETRIEVAL query.
    // It must not replace the user's original wording
    // at the generation stage.
    // =================================================

    const prompt =
      buildScholarPrompt(
        question,
        conferences,
        journals,
        llmContext
      );


    console.log(
      "📝 PROMPT READY:",
      `${prompt.length} chars`
    );


    // =================================================
    // 6. FINAL LLM
    // =================================================

    console.log(
      "🤖 CALLING LLM..."
    );


    const llmResult =
      await callLLM(
        prompt,
        model_id
      );


    console.log(
      "🤖 LLM MODEL:",
      llmResult?.model ||
      "(unknown)"
    );


    console.log(
      "⏱️ LLM LATENCY:",
      llmResult?.latency ??
      "(unknown)",
      "ms"
    );


    if (
      llmResult?.usage
        ?.prompt_tokens !==
        null &&
      llmResult?.usage
        ?.prompt_tokens !==
        undefined
    ) {
      console.log(
        "🔢 LLM PROMPT TOKENS:",
        llmResult
          .usage
          .prompt_tokens
      );
    }


    if (
      llmResult?.usage
        ?.output_tokens !==
        null &&
      llmResult?.usage
        ?.output_tokens !==
        undefined
    ) {
      console.log(
        "🔢 LLM OUTPUT TOKENS:",
        llmResult
          .usage
          .output_tokens
      );
    }


    if (llmResult?.error) {
      console.warn(
        "⚠️ LLM ERROR:",
        llmResult.error
      );
    }


    // =================================================
    // 7. FINAL ANSWER
    //
    // Priority:
    //
    // 1. final LLM answer
    // 2. deterministic runAgent answer
    // 3. local safe fallback
    // =================================================

    let answer =
      typeof llmResult?.answer ===
        "string"
        ? llmResult.answer.trim()
        : "";


    if (!answer) {
      answer =
        typeof result?.answer ===
          "string"
          ? result.answer.trim()
          : "";


      if (answer) {
        console.warn(
          "⚠️ Using deterministic Scholar answer because LLM returned no answer."
        );
      }
    }


    if (!answer) {
      answer =
        buildFallbackAnswer({
          question,
          conferences,
          journals
        });
    }


    // =================================================
    // 8. RESPONSE
    //
    // Portal remains the authoritative conversation
    // memory.
    //
    // Do NOT addToHistory() here.
    // =================================================

    return {
      answer,

      conferences,

      journals,

      sources,

      domain:
        result?.domain ||
        "general",

      /*
       * Useful for debugging contextual retrieval.
       *
       * Existing clients can ignore this field.
       */
      standalone_question:
        standaloneQuestion,

      model: {
        model_id:
          llmResult?.model_id ||
          model_id ||
          null,

        model:
          llmResult?.model ||
          null,

        latency:
          llmResult?.latency ??
          null,

        prompt_tokens:
          llmResult?.usage
            ?.prompt_tokens ??
          null,

        output_tokens:
          llmResult?.usage
            ?.output_tokens ??
          null
      },

      responseTimeMs:
        Date.now() -
        start
    };


  } catch (error) {
    // =================================================
    // GLOBAL ERROR
    // =================================================

    console.error(
      "❌ Scholar agent crash:",
      error
    );


    return {
      answer:
        "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",

      conferences:
        [],

      journals:
        [],

      sources:
        [],

      domain:
        "error",

      standalone_question:
        normalizeText(
          question
        ),

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
        Date.now() -
        start
    };
  }
}