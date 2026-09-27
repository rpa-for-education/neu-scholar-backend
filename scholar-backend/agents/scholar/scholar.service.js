// agents/scholar/scholar.service.js
import { runAgent } from "./scholar.agent.js";
import { buildLLMContext } from "../shared/context.js";
import { rewriteQuery } from "../shared/queryRewriter.js";
import { buildScholarPrompt } from "./scholar.prompt.js";
import { callLLM } from "../shared/llm.js";
import { expandScholarQueries } from "./scholar.search.js";

const SERPAPI_API_KEY =
  "317229a8b9aac04d8acd3c5a504c19dcae02c9b20be7659b4f8f86e9be08fe80";

const MAX_HISTORY = 10;
const MAX_CONTEXT = 5500;

const value = input =>
  input == null
    ? ""
    : typeof input === "string"
      ? input.trim()
      : Array.isArray(input)
        ? input.map(value).filter(Boolean).join(", ")
        : typeof input === "object"
          ? JSON.stringify(input)
          : String(input);

const first = (...values) =>
  values.find(
    item =>
      value(item) &&
      !/^(n\/a|na|null|undefined)$/i.test(
        value(item)
      )
  ) ?? "";

const norm = input =>
  value(input)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function typeOf(question) {
  const q = norm(question);

  const journal =
    /\b(tap chi|journal|issn|scimago|quartile|sjr|q[1-4])\b/.test(
      q
    );

  const conference =
    /\b(hoi thao|hoi nghi|conference|cfp|symposium)\b/.test(
      q
    );

  if (journal && conference) return "both";
  if (journal) return "journal";
  if (conference) return "conference";
  return "general";
}

function detailed(question) {
  return /\b(chi tiet|thong tin|gioi thieu|mo ta|details?|about|cua quyen|tren|do)\b/.test(
    norm(question)
  );
}

function isContextual(question) {
  return /\b(cua toi|cho toi|voi toi|de tai|du an|project|file|tai lieu|ho so|theo noi dung|phu hop|goi y|nen chon|tren|do|nay)\b/.test(
    norm(question)
  );
}

// Chỉ những cách nói trỏ rõ về lượt trước
// mới được kế thừa chủ đề hội thoại.
function followsPrevious(question) {
  return /\b(q[1-4]|con (q[1-4]|loai|nhung)|the (con|va)|tuong tu|khac nua|them nua|o tren|ben tren|vua neu|tap chi (do|nay|tren)|hoi thao (do|nay|tren)|hoi nghi (do|nay|tren)|chung|no|cai do)\b/.test(
    norm(question)
  );
}

function projectRequest(question) {
  return /\b(de tai|du an|project|file|tai lieu|ho so)\b/.test(
    norm(question)
  );
}

function title(item, kind) {
  return value(
    kind === "journal"
      ? first(
          item.title,
          item.name,
          item.journal_title,
          item.source_title
        )
      : first(
          item.name,
          item.title,
          item.conference_name,
          item.event_name,
          item.acronym
        )
  );
}

function url(item, kind) {
  return value(
    kind === "journal"
      ? first(
          item.scimago_link,
          item.url,
          item.link,
          item.website,
          item.homepage
        )
      : first(
          item.cfp_link,
          item.url,
          item.link,
          item.website,
          item.conference_url,
          item.homepage
        )
  );
}

function line(lines, icon, label, input) {
  if (
    value(input) &&
    !/^(n\/a|na|null|undefined)$/i.test(
      value(input)
    )
  ) {
    lines.push(
      `- ${icon} **${label}:** ${value(input)}`
    );
  }
}

function block(item, index, kind, full) {
  const lines = [
    `### ${index + 1}. ${
      kind === "journal" ? "📚" : "🎓"
    } **${title(item, kind)}**`
  ];

  if (kind === "journal") {
    line(
      lines,
      "🏢",
      "Nhà xuất bản",
      first(item.publisher, item.publisher_name)
    );
    line(
      lines,
      "🌍",
      "Quốc gia",
      first(item.country, item.country_name)
    );
    line(
      lines,
      "🧭",
      "Lĩnh vực",
      first(item.areas, item.fields)
    );
    line(
      lines,
      "🏷️",
      "Danh mục",
      first(item.categories, item.category)
    );
    line(
      lines,
      "🏆",
      "Quartile",
      first(
        item.quartile,
        item.sjr_best_quartile,
        item.best_quartile
      )
    );
    line(
      lines,
      "🆔",
      "ISSN",
      first(
        item.issn,
        item.primary_issn,
        item.issns,
        item.e_issn,
        item.p_issn
      )
    );

    if (full) {
      line(lines, "📊", "SJR", item.sjr);
      line(
        lines,
        "📈",
        "H-index",
        first(item.h_index, item.hindex)
      );
      line(
        lines,
        "📖",
        "Giai đoạn xuất bản",
        item.coverage
      );
      line(
        lines,
        "📝",
        "Mô tả",
        first(item.description, item.text)
      );
    }
  } else {
    line(
      lines,
      "🏷️",
      "Tên viết tắt",
      item.acronym
    );
    line(
      lines,
      "📍",
      "Địa điểm",
      first(
        item.location,
        item.venue,
        [item.city, item.country]
          .filter(Boolean)
          .join(", ")
      )
    );
    line(
      lines,
      "⏳",
      "Hạn nộp bài",
      first(
        item.deadline,
        item.submission_deadline,
        item.paper_deadline
      )
    );
    line(
      lines,
      "📅",
      "Ngày bắt đầu",
      first(item.start_date, item.event_date)
    );
    line(
      lines,
      "🗓️",
      "Ngày kết thúc",
      item.end_date
    );

    if (full) {
      line(
        lines,
        "🏛️",
        "Đơn vị tổ chức",
        item.organizer
      );
      line(
        lines,
        "🧭",
        "Lĩnh vực",
        first(
          item.fields,
          item.areas,
          item.categories
        )
      );
      line(
        lines,
        "💬",
        "Chủ đề",
        first(item.topics, item.topic)
      );
      line(
        lines,
        "📝",
        "Thông tin CFP",
        first(
          item.cfp_text,
          item.description,
          item.text
        )
      );
    }
  }

  line(
    lines,
    "🔗",
    "Liên kết",
    url(item, kind)
  );

  return lines.join("\n");
}

function format(conferences, journals, full) {
  return [
    conferences.length
      ? `## 🎓 Hội thảo liên quan\n\n${conferences
          .map((item, index) =>
            block(item, index, "conference", full)
          )
          .join("\n\n")}`
      : "",
    journals.length
      ? `## 📚 Tạp chí liên quan\n\n${journals
          .map((item, index) =>
            block(item, index, "journal", full)
          )
          .join("\n\n")}`
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function contextOf(req, passedHistory) {
  const portal =
    req?.body?.context || {};

  let base = {};

  try {
    base =
      buildLLMContext(req) || {};
  } catch (error) {
    console.warn(
      "Scholar context:",
      error?.message || error
    );
  }

  const rawHistory =
    Array.isArray(portal.history)
      ? portal.history
      : Array.isArray(passedHistory) &&
          passedHistory.length
        ? passedHistory
        : base.history;

  const history = (
    Array.isArray(rawHistory)
      ? rawHistory
      : []
  )
    .filter(
      item =>
        item &&
        ["user", "assistant"].includes(
          item.role
        ) &&
        typeof item.content ===
          "string" &&
        item.content.trim()
    )
    .slice(-MAX_HISTORY)
    .map(item => ({
      role: item.role,
      content: item.content.slice(
        0,
        2500
      )
    }));

  const rawDocs =
    portal.extra_data?.document ??
    portal.document ??
    base.docs ??
    [];

  const docs = (
    Array.isArray(rawDocs)
      ? rawDocs
      : [rawDocs]
  )
    .filter(
      item =>
        item &&
        typeof item.text ===
          "string" &&
        item.text.trim()
    )
    .slice(0, 8)
    .map(item => ({
      name: value(item.name),
      text: item.text
    }));

  return {
    ...base,
    history,
    profile:
      portal.user_profile ??
      base.profile ??
      null,
    project:
      portal.project_info ??
      base.project ??
      null,
    project_id:
      portal.project_id ??
      base.project_id ??
      null,
    docs
  };
}

function scopeText(context) {
  const project =
    context.project
      ? `Dự án: ${value(
          context.project.name
        )}. ${value(
          context.project.description
        )}`
      : "";

  const files = context.docs
    .map(
      doc =>
        `File ${doc.name}: ${doc.text.slice(
          0,
          1600
        )}`
    )
    .join("\n");

  return `${project}\n${files}`
    .slice(0, MAX_CONTEXT)
    .trim();
}

function lastTopic(context) {
  const previous =
    context.history
      .slice()
      .reverse()
      .find(
        item =>
          item.role === "user" &&
          typeOf(item.content) !==
            "general"
      );

  return previous?.content || "";
}

function namedFromHistory(context) {
  const previous =
    context.history
      .slice()
      .reverse()
      .find(
        item =>
          item.role ===
            "assistant" &&
          /\*\*[^*]{8,}\*\*/.test(
            item.content
          )
      );

  const heading =
    previous?.content.match(
      /###\s*\d+\.\s*(?:🎓|📚)?\s*\*\*([^*]+)\*\*/
    );

  return heading?.[1]?.trim() || "";
}

async function retrievalQuery(
  question,
  context,
  modelId
) {
  let query =
    question;

  // Câu hỏi độc lập không được biến thành
  // truy vấn học thuật chỉ vì history có tạp chí.
  if (
    typeOf(question) ===
      "general" &&
    !followsPrevious(
      question
    ) &&
    !projectRequest(
      question
    )
  ) {
    return query;
  }

  const requestedQuartile =
    norm(question).match(
      /\bq[1-4]\b/
    )?.[0];

  const previousTopic =
    lastTopic(
      context
    );

  // "Còn Q2?" kế thừa chủ đề trước và
  // thay Q1 bằng Q2, không giữ cả hai.
  if (
    requestedQuartile &&
    previousTopic &&
    !/\b(tap chi|journal|hoi thao|conference)\b/.test(
      norm(question)
    )
  ) {
    return `${
      previousTopic.replace(
        /\bq[1-4]\b/gi,
        requestedQuartile
      )
    }. ${question}`;
  }

  // Câu hỏi đã đầy đủ loại và chủ đề:
  // giữ nguyên yêu cầu người dùng.
  if (
    typeOf(question) !==
      "general" &&
    !followsPrevious(
      question
    ) &&
    norm(question)
      .split(" ")
      .length > 5
  ) {
    return question;
  }

  try {
    const rewritten =
      await rewriteQuery(
        question,
        context.history
      );

    if (
      typeof rewritten ===
        "string" &&
      rewritten.trim()
    ) {
      query =
        rewritten.trim();
    }
  } catch (error) {
    console.warn(
      "Scholar rewrite:",
      error?.message || error
    );
  }

  if (
    typeOf(question) ===
      "general" &&
    typeOf(query) ===
      "general" &&
    previousTopic &&
    isContextual(
      question
    )
  ) {
    query =
      `${previousTopic}. ${question}`;
  }

  const named =
    namedFromHistory(
      context
    );

  if (
    named &&
    /\b(tren|do|nay|chi tiet|thong tin)\b/.test(
      norm(question)
    ) &&
    !norm(query).includes(
      norm(named)
    )
  ) {
    query =
      `${query}. ${named}`;
  }

  const subject =
    scopeText(
      context
    );

  if (
    subject &&
    isContextual(
      question
    ) &&
    !named
  ) {
    try {
      const llm =
        await callLLM(
          `Viết MỘT câu truy vấn tìm kiếm tạp chí/hội thảo bằng tiếng Việt và từ khóa tiếng Anh dựa trên câu hỏi và đề tài/file. Giữ nguyên yêu cầu về loại, Q1/Q2, nước, năm. Chỉ xuất truy vấn, không nhận xét, tối đa 220 ký tự.\nCâu hỏi: ${query}\nNgữ cảnh: ${subject}`,
          modelId
        );

      const candidate =
        value(
          llm?.answer
        )
          .replace(
            /\s+/g,
            " "
          )
          .slice(
            0,
            220
          );

      if (
        candidate &&
        typeOf(candidate) !==
          "general" &&
        (
          typeOf(question) ===
            "general" ||
          typeOf(candidate) ===
            typeOf(question)
        )
      ) {
        query =
          candidate;
      }
    } catch (error) {
      console.warn(
        "Scholar contextual query:",
        error?.message ||
          error
      );
    }

    if (
      typeOf(query) !==
      "general"
    ) {
      query +=
        ` ${subject.slice(
          0,
          350
        )}`;
    }
  }

  return query;
}

async function searchWeb(
  query,
  kind
) {
  const expanded =
    await expandScholarQueries(
      query
    );

  const queries = (
    expanded?.queries?.length
      ? expanded.queries
      : [query]
  ).slice(0, 3);

  const batches =
    await Promise.allSettled(
      queries.map(
        async item => {
          const typed =
            kind ===
            "journal"
              ? `${item} journal -conference -workshop`
              : kind ===
                  "conference"
                ? `${item} conference CFP -journal`
                : item;

          const params =
            new URLSearchParams({
              engine:
                "google",
              q: typed,
              num: "8",
              api_key:
                SERPAPI_API_KEY
            });

          const response =
            await fetch(
              `https://serpapi.com/search.json?${params}`,
              {
                signal:
                  AbortSignal.timeout(
                    15000
                  )
              }
            );

          if (
            !response.ok
          ) {
            throw new Error(
              `SerpAPI HTTP ${response.status}`
            );
          }

          const data =
            await response.json();

          if (
            data.error
          ) {
            throw new Error(
              data.error
            );
          }

          return (
            data.organic_results ||
            []
          );
        }
      )
    );

  const unique =
    new Map();

  for (
    const batch of
    batches
  ) {
    if (
      batch.status !==
      "fulfilled"
    ) {
      continue;
    }

    for (
      const item of
      batch.value
    ) {
      if (
        !item.link ||
        !item.snippet ||
        unique.has(
          item.link
        )
      ) {
        continue;
      }

      const heading =
        norm(
          `${item.title} ${item.link}`
        );

      if (
        kind ===
          "journal" &&
        /\b(conference|workshop|symposium|hoi thao)\b/.test(
          heading
        )
      ) {
        continue;
      }

      if (
        kind ===
          "conference" &&
        /\b(journal ranking|journal quartile)\b/.test(
          heading
        )
      ) {
        continue;
      }

      unique.set(
        item.link,
        {
          id: `W${
            unique.size +
            1
          }`,
          type:
            "web",
          title:
            value(
              item.title
            ),
          url:
            item.link,
          content:
            value(
              item.snippet
            ).slice(
              0,
              1500
            )
        }
      );

      if (
        unique.size ===
        5
      ) {
        break;
      }
    }
  }

  return [
    ...unique.values()
  ];
}

const evidence =
  items =>
    items
      .map(
        item =>
          `[${item.id}] ${item.title}\nURL: ${item.url}\nTrích đoạn: ${item.content}`
      )
      .join(
        "\n\n"
      );

function webAnswer(
  answer,
  web
) {
  const ids = [
    ...new Set(
      [
        ...answer.matchAll(
          /\[W(\d+)\]/g
        )
      ].map(
        match =>
          `W${match[1]}`
      )
    )
  ];

  const used =
    web.filter(
      item =>
        ids.includes(
          item.id
        )
    );

  return used.length
    ? `${answer}\n\n**Nguồn tham khảo**\n${used
        .map(
          item =>
            `- [${item.id}] [${item.title}](${item.url})`
        )
        .join("\n")}`
    : answer;
}

function guard(
  answer,
  kind,
  conferences,
  journals
) {
  if (
    !answer ||
    /===\s*(TẠP CHÍ|HỘI THẢO)|_qdrant|finalScore|baseScore/i.test(
      answer
    )
  ) {
    return false;
  }

  // Khi đã trả bản ghi CSDL, không lấy mã
  // web từ lịch sử rồi lặp nguồn tham khảo.
  if (
    /\[W\d+\]|\*\*Nguồn tham khảo\*\*/i.test(
      answer
    ) &&
    (
      conferences.length ||
      journals.length
    )
  ) {
    return false;
  }

  if (
    kind ===
      "journal" &&
    /##\s*🎓\s*Hội thảo/i.test(
      answer
    )
  ) {
    return false;
  }

  if (
    kind ===
      "conference" &&
    /##\s*📚\s*Tạp chí/i.test(
      answer
    )
  ) {
    return false;
  }

  const names = [
    ...conferences.map(
      item =>
        norm(
          title(
            item,
            "conference"
          )
        )
    ),
    ...journals.map(
      item =>
        norm(
          title(
            item,
            "journal"
          )
        )
    )
  ].filter(Boolean);

  return (
    !names.length ||
    names.every(
      name =>
        norm(
          answer
        ).includes(
          name
        )
    )
  );
}

export async function runScholarAgent(
  req,
  question,
  model_id,
  topk,
  history = []
) {
  const started =
    Date.now();

  const original =
    value(
      question ||
        req?.body
          ?.message ||
        req?.body
          ?.question
    );

  const reply = (
    answer,
    domain,
    standalone,
    llm = null,
    sources = [],
    conferences = [],
    journals = []
  ) => ({
    answer,
    conferences,
    journals,
    sources,
    domain,
    standalone_question:
      standalone,
    model: {
      model_id:
        llm?.model_id ||
        model_id ||
        null,
      model:
        llm?.model ||
        null,
      latency:
        llm?.latency ??
        null,
      prompt_tokens:
        llm?.usage
          ?.prompt_tokens ??
        null,
      output_tokens:
        llm?.usage
          ?.output_tokens ??
        null
    },
    responseTimeMs:
      Date.now() -
      started
  });

  if (
    !original
  ) {
    return reply(
      "Vui lòng nhập câu hỏi.",
      "general",
      ""
    );
  }

  try {
    const context =
      contextOf(
        req,
        history
      );

    const explicit =
      typeOf(
        original
      );

    const followup =
      followsPrevious(
        original
      );

    // Quyết định dựa trên câu hỏi gốc
    // trước khi gọi query rewriter.
    const independentGeneral =
      explicit ===
        "general" &&
      !followup &&
      !projectRequest(
        original
      );

    const standalone =
      independentGeneral
        ? original
        : await retrievalQuery(
            original,
            context,
            model_id
          );

    let kind =
      independentGeneral
        ? "general"
        : explicit !==
            "general"
          ? explicit
          : typeOf(
              standalone
            );

    let preflight =
      null;

    if (
      kind ===
        "general" &&
      detailed(
        original
      ) &&
      !independentGeneral
    ) {
      const check =
        await runAgent(
          standalone,
          topk,
          context.history
        );

      const matches = (
        items,
        type
      ) =>
        items.filter(
          item => {
            const name =
              norm(
                title(
                  item,
                  type
                )
              );

            return (
              name.length >=
                8 &&
              norm(
                original
              ).includes(
                name
              )
            );
          }
        );

      const foundConferences =
        matches(
          check
            ?.conferences ||
            [],
          "conference"
        );

      const foundJournals =
        matches(
          check
            ?.journals ||
            [],
          "journal"
        );

      if (
        foundConferences
          .length ||
        foundJournals
          .length
      ) {
        kind =
          foundConferences
            .length &&
          foundJournals
            .length
            ? "both"
            : foundConferences
                .length
              ? "conference"
              : "journal";

        preflight =
          {
            conferences:
              foundConferences,
            journals:
              foundJournals
          };
      }
    }

    if (
      kind ===
      "general"
    ) {
      const prior =
        lastTopic(
          context
        );

      if (
        prior &&
        followup
      ) {
        kind =
          typeOf(
            prior
          );
      }
    }

    if (
      kind ===
      "general"
    ) {
      const prompt =
        [
          "Trả lời câu hỏi bằng tiếng Việt tự nhiên. Dùng hồ sơ để cá nhân hóa khi thích hợp, giới hạn theo dự án đang mở; chỉ dùng nội dung file đã trích, không tự nhận đã đọc URL. Không bịa thông tin.",

          context.profile
            ? `Hồ sơ: ${JSON.stringify(
                context.profile
              ).slice(
                0,
                1500
              )}`
            : "",

          context.project
            ? `Dự án: ${JSON.stringify(
                context.project
              ).slice(
                0,
                2500
              )}`
            : "",

          scopeText(
            context
          ),

          context.history
            .map(
              item =>
                `${item.role}: ${item.content.slice(
                  0,
                  700
                )}`
            )
            .join(
              "\n"
            ),

          `Câu hỏi: ${original}`
        ]
          .filter(
            Boolean
          )
          .join(
            "\n\n"
          );

      const llm =
        await callLLM(
          prompt,
          model_id
        );

      return reply(
        value(
          llm?.answer
        ) ||
          "Tôi chưa thể trả lời lúc này.",
        "general",
        standalone,
        llm
      );
    }

    const found =
      preflight ||
      (await runAgent(
        standalone,
        topk,
        context.history
      ));

    const conferences =
      kind ===
      "journal"
        ? []
        : found
            ?.conferences ||
          [];

    const journals =
      kind ===
      "conference"
        ? []
        : found
            ?.journals ||
          [];

    const sources =
      [
        ...conferences.map(
          (
            item,
            index
          ) => ({
            id: `C${
              index +
              1
            }`,
            type:
              "conference",
            title:
              title(
                item,
                "conference"
              ),
            url:
              url(
                item,
                "conference"
              ),
            metadata:
              item
          })
        ),

        ...journals.map(
          (
            item,
            index
          ) => ({
            id: `J${
              index +
              1
            }`,
            type:
              "journal",
            title:
              title(
                item,
                "journal"
              ),
            url:
              url(
                item,
                "journal"
              ),
            metadata:
              item
          })
        )
      ];

    const full =
      detailed(
        original
      );

    const fallback =
      format(
        conferences,
        journals,
        full
      );

    if (
      fallback
    ) {
      const needsLLM =
        full ||
        (
          isContextual(
            original
          ) &&
          (
            context.project ||
            context.profile ||
            context.docs
              .length
          )
        );

      if (
        !needsLLM
      ) {
        return reply(
          fallback,
          kind,
          standalone,
          null,
          sources,
          conferences,
          journals
        );
      }

      try {
        const llm =
          await callLLM(
            buildScholarPrompt(
              original,
              conferences,
              journals,
              context
            ),
            model_id
          );

        const answer =
          value(
            llm
              ?.answer
          );

        return reply(
          guard(
            answer,
            kind,
            conferences,
            journals
          )
            ? answer
            : fallback,
          kind,
          standalone,
          llm,
          sources,
          conferences,
          journals
        );
      } catch (
        error
      ) {
        console.warn(
          "Scholar generation:",
          error
            ?.message ||
            error
        );

        return reply(
          fallback,
          kind,
          standalone,
          null,
          sources,
          conferences,
          journals
        );
      }
    }

    let web = [];

    try {
      web =
        await searchWeb(
          standalone,
          kind
        );
    } catch (error) {
      console.warn(
        "Scholar web:",
        error
          ?.message ||
          error
      );
    }

    if (
      !web.length
    ) {
      return reply(
        "Chưa tìm thấy kết quả phù hợp trong CSDL và chưa xác minh được nguồn web phù hợp.",
        kind,
        standalone
      );
    }

    const prompt =
      [
        `Trả lời bằng tiếng Việt, đúng loại ${kind}. Chỉ dùng thông tin được nguồn xác nhận, dẫn [W1] sát từng nhận định. Không suy đoán ISSN, Q1, hạn nộp hoặc địa điểm. Nếu nguồn không đủ để xác minh điều kiện bắt buộc, nói rõ. Mỗi bản ghi ở một mục riêng, có dòng trống.`,

        context.project
          ? `Dự án: ${JSON.stringify(
              context.project
            ).slice(
              0,
              1800
            )}`
          : "",

        context.profile
          ? `Hồ sơ: ${JSON.stringify(
              context.profile
            ).slice(
              0,
              900
            )}`
          : "",

        scopeText(
          context
        ),

        context.history
          .map(
            item =>
              `${item.role}: ${item.content.slice(
                0,
                500
              )}`
          )
          .join(
            "\n"
          ),

        `Câu hỏi: ${original}`,

        `Nguồn:\n${evidence(
          web
        )}`
      ]
        .filter(
          Boolean
        )
        .join(
          "\n\n"
        );

    const llm =
      await callLLM(
        prompt,
        model_id
      );

    const answer =
      value(
        llm
          ?.answer
      );

    const grounded =
      guard(
        answer,
        kind,
        [],
        []
      ) &&
      /\[W\d+\]/.test(
        answer
      );

    return reply(
      webAnswer(
        grounded
          ? answer
          : "Chưa xác minh được kết quả đáp ứng yêu cầu từ các nguồn web tìm thấy.",
        web
      ),
      kind,
      standalone,
      llm,
      grounded
        ? web.filter(
            item =>
              answer.includes(
                `[${item.id}]`
              )
          )
        : []
    );
  } catch (error) {
    console.error(
      "Scholar service:",
      error
    );

    return reply(
      "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",
      "error",
      original
    );
  }
}