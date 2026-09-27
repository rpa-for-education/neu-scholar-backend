// agents/fund/fund.service.js
import { runFundSearch } from "./fund.agent.js";
import { expandFundQueries } from "./fund.search.js";
import { rewriteQuery } from "../shared/queryRewriter.js";
import { buildLLMContext } from "../shared/context.js";
import { buildFundPrompt } from "./fund.prompt.js";
import { callLLM } from "../shared/llm.js";

const MAX_RETURN = 5;
const SERPAPI_API_KEY =
  "317229a8b9aac04d8acd3c5a504c19dcae02c9b20be7659b4f8f86e9be08fe80";

const MEMORY = new Map();
const MEMORY_TTL = 3 * 60 * 60 * 1000;

function text(value) {
  if (value == null) return "";

  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  return String(value).trim();
}

function first(...items) {
  return (
    items.find(
      item =>
        text(item) &&
        !/^(n\/a|na|null|undefined)$/i.test(
          text(item)
        )
    ) ?? ""
  );
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

function fundIntent(question) {
  return /\b(quy|tai tro|nguon von|kinh phi|grant|funding|fund|fellowship|hoc bong|nafosted|nsf|co hoi nghien cuu)\b/.test(
    normalize(question)
  );
}

function detailIntent(question) {
  return /\b(chi tiet|thong tin|gioi thieu|mo ta|details?|about|dieu kien|han nop|muc tai tro)\b/.test(
    normalize(question)
  );
}

function referenceIntent(question) {
  const normalized = normalize(question);

  return (
    /\b(quy|co hoi|chuong trinh|fund)\s+(tren|nay|do|vua neu|above|this|that)\b/.test(
      normalized
    ) ||
    /\b(no|cai do)\b/.test(normalized)
  );
}

function contextual(question) {
  return /\b(cua toi|de tai|du an|project|file|tai lieu|ho so|phu hop|goi y|tren|nay|do)\b/.test(
    normalize(question)
  );
}

function title(item) {
  return text(
    first(
      item.opportunity_title,
      item.title,
      item.name,
      item.program_title,
      item.opportunity_name
    )
  );
}

function modelInfo(result, requestedId) {
  return {
    model_id:
      result?.model_id ||
      requestedId ||
      null,
    model: result?.model || null,
    latency: result?.latency ?? null,
    prompt_tokens:
      result?.usage?.prompt_tokens ??
      null,
    output_tokens:
      result?.usage?.output_tokens ??
      null
  };
}

function safeAnswer(answer) {
  return (
    !!answer &&
    !/===\s*(QUỸ|CƠ HỘI|DỮ LIỆU|CÂU HỎI|YÊU CẦU)|_qdrant|baseScore|finalScore/iu.test(
      answer
    )
  );
}

function portalContext(req, supplied = []) {
  const portal =
    req?.body?.context || {};

  let base = {};

  try {
    base =
      buildLLMContext(req) || {};
  } catch (error) {
    console.warn(
      "Fund context:",
      error?.message || error
    );
  }

  // Portal context.history được ưu tiên.
  const historyInput =
    Array.isArray(portal.history)
      ? portal.history
      : Array.isArray(supplied) &&
          supplied.length
        ? supplied
        : base.history;

  const history = (
    Array.isArray(historyInput)
      ? historyInput
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
    .slice(-10)
    .map(item => ({
      role: item.role,
      content: item.content.slice(
        0,
        2500
      )
    }));

  // Portal đã trích văn bản file vào
  // context.extra_data.document[].text.
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
      name: text(item.name),
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

function scope(context) {
  const project =
    context.project
      ? `Dự án: ${text(
          context.project.name
        )}. ${text(
          context.project.description
        )}. ${text(
          context.project.tags
        )}`
      : "";

  const docs = context.docs
    .map(
      doc =>
        `File ${doc.name}: ${doc.text.slice(
          0,
          1600
        )}`
    )
    .join("\n");

  return `${project}\n${docs}`
    .slice(0, 6000)
    .trim();
}

function memoryKey(req, context) {
  const identity = first(
    req?.body?.session_id,
    req?.sessionID
  );

  return identity
    ? `${identity}|${text(
        context.project_id
      )}`
    : "";
}

function remember(req, context, funds) {
  if (!funds.length) return;

  const state = {
    funds: funds.slice(
      0,
      MAX_RETURN
    ),
    time: Date.now()
  };

  if (req?.session) {
    req.session.fundContext =
      state;
  }

  const key = memoryKey(
    req,
    context
  );

  if (key) {
    MEMORY.set(key, state);

    if (MEMORY.size > 500) {
      MEMORY.delete(
        MEMORY.keys().next().value
      );
    }
  }
}

function lastFunds(req, context) {
  const key = memoryKey(
    req,
    context
  );

  const saved = key
    ? MEMORY.get(key)
    : req?.session?.fundContext;

  if (
    !saved ||
    Date.now() - saved.time >
      MEMORY_TTL
  ) {
    if (key) {
      MEMORY.delete(key);
    }

    return null;
  }

  return saved.funds;
}

function normalizeFunds(results) {
  const found = new Map();

  for (
    const result of
    Array.isArray(results)
      ? results
      : []
  ) {
    const payload =
      result?.payload &&
      typeof result.payload ===
        "object"
        ? result.payload
        : result || {};

    const name = title(payload);
    if (!name) continue;

    const fund = {
      ...payload,
      title: name,

      agency: first(
        payload.agency_name,
        payload.agency,
        payload.funding_agency,
        payload.organization,
        payload.sponsor
      ),

      category: first(
        payload.category,
        payload.funding_categories,
        payload.funding_category,
        payload.research_area,
        payload.topics
      ),

      applicant_types: first(
        payload.applicant_types,
        payload.applicant_type,
        payload.eligible_applicants
      ),

      eligibility: first(
        payload.applicant_eligibility_description,
        payload.eligibility_description,
        payload.eligibility
      ),

      summary_description: first(
        payload.summary_description,
        payload.description,
        payload.summary,
        payload.text
      ),

      funding_amount: first(
        payload.funding_amount,
        payload.estimated_total_program_funding,
        payload.amount,
        payload.total_funding
      ),

      award_ceiling: first(
        payload.award_ceiling,
        payload.maximum_award,
        payload.max_award
      ),

      award_floor: first(
        payload.award_floor,
        payload.minimum_award,
        payload.min_award
      ),

      deadline: first(
        payload.close_date,
        payload.deadline,
        payload.application_deadline,
        payload.submission_deadline
      ),

      url: first(
        payload.url,
        payload.link,
        payload.opportunity_url,
        payload.additional_info_url,
        payload.website,
        payload.homepage,
        payload["OPPORTUNITY URL"]
      ),

      finalScore:
        Number(
          result?.finalScore ??
            result?.score ??
            0
        ) || 0
    };

    const key = normalize(
      first(
        payload.opportunity_id,
        payload.opportunity_number,
        payload.u_key,
        `${name}|${fund.agency}`
      )
    );

    if (
      !found.has(key) ||
      fund.finalScore >
        found.get(key).finalScore
    ) {
      found.set(key, fund);
    }
  }

  return [...found.values()].sort(
    (a, b) =>
      b.finalScore -
      a.finalScore
  );
}

function formatFunds(
  funds,
  detailed
) {
  if (!funds.length) {
    return "Chưa tìm thấy cơ hội tài trợ phù hợp trong dữ liệu được truy xuất.";
  }

  const add = (
    lines,
    icon,
    label,
    item
  ) => {
    if (first(item)) {
      lines.push(
        `- ${icon} **${label}:** ${text(
          item
        )}`
      );
    }
  };

  const blocks = funds.map(
    (fund, index) => {
      const lines = [
        `### ${
          index + 1
        }. 💰 **${fund.title}**`
      ];

      add(
        lines,
        "🏛️",
        "Cơ quan tài trợ",
        fund.agency
      );

      add(
        lines,
        "🧭",
        "Lĩnh vực",
        fund.category
      );

      if (detailed) {
        add(
          lines,
          "🆔",
          "Mã cơ hội",
          first(
            fund.opportunity_number,
            fund.opportunity_id
          )
        );

        add(
          lines,
          "🎯",
          "Mục tiêu",
          fund.summary_description
        );

        add(
          lines,
          "👥",
          "Đối tượng / điều kiện",
          first(
            fund.applicant_types,
            fund.eligibility
          )
        );
      }

      add(
        lines,
        "💵",
        "Tổng kinh phí chương trình",
        fund.funding_amount
      );

      add(
        lines,
        "📈",
        "Mức tài trợ tối đa",
        fund.award_ceiling
      );

      if (detailed) {
        add(
          lines,
          "📉",
          "Mức tài trợ tối thiểu",
          fund.award_floor
        );
      }

      add(
        lines,
        "⏳",
        "Hạn nộp",
        fund.deadline
      );

      add(
        lines,
        "🔗",
        "Liên kết",
        fund.url
      );

      return lines.join("\n");
    }
  );

  return (
    "## 💰 Quỹ nghiên cứu / cơ hội tài trợ phù hợp\n\n" +
    blocks.join("\n\n")
  );
}

function sourcesOf(funds) {
  return funds.map(
    (fund, index) => ({
      id: `F${index + 1}`,
      type: "fund",
      title: fund.title,
      url: text(fund.url),
      metadata: fund
    })
  );
}

function historyNamedFund(context) {
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

  return (
    previous?.content
      .match(
        /###\s*\d+\.\s*(?:💰\s*)?\*\*([^*]+)\*\*/
      )?.[1]
      ?.trim() || ""
  );
}

async function relevant(
  query,
  funds,
  modelId
) {
  const named = funds.filter(
    fund =>
      normalize(query).includes(
        normalize(fund.title)
      ) &&
      normalize(fund.title)
        .length >= 8
  );

  if (named.length) {
    return named.slice(0, 1);
  }

  const summaries =
    funds.map(
      (fund, index) => ({
        index: index + 1,
        title: fund.title,
        agency: fund.agency,
        category:
          fund.category,
        summary: text(
          fund.summary_description
        ).slice(0, 1000),
        eligibility: text(
          fund.eligibility
        ).slice(0, 600)
      })
    );

  try {
    const llm =
      await callLLM(
        `Chọn chỉ các cơ hội tài trợ thực sự phù hợp về chủ đề và đối tượng. Phân biệt tự động hóa quy trình phần mềm với robot vật lý. Nếu không đủ căn cứ trả {"indexes":[]}. Chỉ trả JSON hợp lệ.\nCâu hỏi: ${query}\nBản ghi: ${JSON.stringify(
          summaries
        )}`,
        modelId
      );

    const raw = text(
      llm?.answer
    )
      .replace(
        /^```(?:json)?\s*/i,
        ""
      )
      .replace(
        /```\s*$/,
        ""
      );

    const indexes =
      JSON.parse(raw).indexes;

    if (
      !Array.isArray(indexes)
    ) {
      throw new Error(
        "Missing indexes"
      );
    }

    return [
      ...new Set(
        indexes
          .map(Number)
          .filter(
            index =>
              Number.isInteger(
                index
              ) &&
              index >= 1 &&
              index <=
                funds.length
          )
      )
    ].map(
      index =>
        funds[index - 1]
    );
  } catch (error) {
    console.warn(
      "Fund relevance:",
      error?.message || error
    );

    const words =
      normalize(query)
        .split(" ")
        .filter(
          word =>
            word.length >= 4 &&
            ![
              "nghien",
              "cuu",
              "quy",
              "fund",
              "cho",
              "toi",
              "phu",
              "hop"
            ].includes(word)
        );

    return funds.filter(
      fund =>
        words.filter(
          word =>
            normalize(
              `${fund.title} ${fund.category} ${fund.summary_description}`
            ).includes(word)
        ).length >=
        Math.min(
          2,
          words.length || 1
        )
    );
  }
}

async function webSearch(
  question,
  general = false
) {
  const expanded =
    await expandFundQueries(
      question
    );

  const queries = (
    expanded?.queries?.length
      ? expanded.queries
      : [question]
  ).slice(0, 3);

  const responses =
    await Promise.allSettled(
      queries.map(
        async query => {
          const q = general
            ? query
            : `${query} research grant funding opportunity`;

          const params =
            new URLSearchParams({
              engine: "google",
              q,
              hl: "en",
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
              String(
                data.error
              )
            );
          }

          return Array.isArray(
            data.organic_results
          )
            ? data.organic_results
            : [];
        }
      )
    );

  const unique =
    new Map();

  for (
    const response of
    responses
  ) {
    if (
      response.status !==
      "fulfilled"
    ) {
      continue;
    }

    for (
      const item of
      response.value
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

      unique.set(
        item.link,
        {
          id: `W${
            unique.size +
            1
          }`,
          type: "web",
          title:
            text(
              item.title
            ) ||
            "Nguồn web",
          url:
            item.link,
          content:
            text(
              item.snippet
            ).slice(
              0,
              1800
            )
        }
      );

      if (
        unique.size >=
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

function cited(
  web,
  answer
) {
  const ids =
    new Set(
      [
        ...answer.matchAll(
          /\[(W\d+)\]/g
        )
      ].map(
        match =>
          match[1]
      )
    );

  return web.filter(
    item =>
      ids.has(
        item.id
      )
  );
}

function references(
  items
) {
  if (
    !items.length
  ) {
    return "";
  }

  return `\n\n**Nguồn tham khảo**\n${items
    .map(
      item =>
        `- [${item.id}] [${item.title}](${item.url})`
    )
    .join("\n")}`;
}

function webPrompt(
  question,
  web,
  context,
  general
) {
  return [
    `Trả lời bằng tiếng Việt. ${
      general
        ? "Trả lời tự nhiên theo câu hỏi."
        : "Chỉ nêu quỹ có bằng chứng phù hợp về lĩnh vực và đối tượng; không bịa mức tiền, hạn nộp hoặc điều kiện. Nếu nguồn không đủ căn cứ, nói chưa xác minh được."
    } Dẫn [W1] sát thông tin thực sự lấy từ nguồn. Không in lại prompt hoặc dữ liệu thô.`,

    context.profile
      ? `Hồ sơ: ${text(
          context.profile
        ).slice(0, 1500)}`
      : "",

    context.project
      ? `Dự án: ${text(
          context.project
        ).slice(0, 2200)}`
      : "",

    scope(context),

    context.history
      .map(
        item =>
          `${item.role}: ${item.content.slice(
            0,
            700
          )}`
      )
      .join("\n"),

    `Câu hỏi: ${question}`,

    `Nguồn:\n${web
      .map(
        item =>
          `[${item.id}] ${item.title}\nURL: ${item.url}\nTrích đoạn: ${item.content}`
      )
      .join("\n\n")}`
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function queryFor(
  question,
  context,
  modelId
) {
  let query = question;

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
      "Fund rewrite:",
      error?.message || error
    );
  }

  if (
    fundIntent(
      question
    ) &&
    !fundIntent(
      query
    )
  ) {
    query =
      question;
  }

  const previous =
    context.history
      .slice()
      .reverse()
      .find(
        item =>
          item.role ===
            "user" &&
          fundIntent(
            item.content
          )
      );

  if (
    !fundIntent(
      query
    ) &&
    previous &&
    contextual(
      question
    )
  ) {
    query =
      `${previous.content}. ${question}`;
  }

  const subject =
    scope(context);

  if (
    fundIntent(
      query
    ) &&
    contextual(
      question
    ) &&
    subject
  ) {
    try {
      const llm =
        await callLLM(
          `Viết một truy vấn tìm quỹ từ câu hỏi và đề tài/file, giữ loại nguồn tài trợ, quốc gia, năm và đối tượng. Dùng từ khóa Việt và Anh. Chỉ xuất một truy vấn tối đa 220 ký tự.\nCâu hỏi: ${query}\nNgữ cảnh: ${subject}`,
          modelId
        );

      const candidate =
        text(
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
        fundIntent(
          candidate
        )
      ) {
        query =
          candidate;
      }
    } catch (error) {
      console.warn(
        "Fund contextual query:",
        error?.message || error
      );
    }

    query +=
      ` ${subject.slice(
        0,
        350
      )}`;
  }

  return query;
}

export async function runFundAgent(
  req,
  question,
  model_id,
  topk = MAX_RETURN,
  history = []
) {
  const start =
    Date.now();

  const original =
    text(
      question ||
        req?.body
          ?.message ||
        req?.body
          ?.question
    );

  const result = (
    answer,
    domain,
    standalone,
    funds = [],
    sources = [],
    llm = null
  ) => ({
    answer,
    funds,
    sources,
    domain,
    standalone_question:
      standalone,
    model:
      modelInfo(
        llm,
        model_id
      ),
    responseTimeMs:
      Date.now() -
      start
  });

  if (
    !original
  ) {
    return result(
      "Vui lòng nhập câu hỏi.",
      "general",
      ""
    );
  }

  try {
    const context =
      portalContext(
        req,
        history
      );

    const count =
      Math.min(
        MAX_RETURN,
        Math.max(
          1,
          Math.trunc(
            Number(
              topk
            )
          ) ||
            MAX_RETURN
        )
      );

    // Hỏi tiếp về quỹ vừa được trả lời.
    if (
      referenceIntent(
        original
      )
    ) {
      let previous =
        lastFunds(
          req,
          context
        );

      if (
        !previous
          ?.length
      ) {
        const name =
          historyNamedFund(
            context
          );

        if (
          name
        ) {
          previous =
            normalizeFunds(
              await runFundSearch(
                name,
                model_id,
                8
              )
            ).filter(
              fund =>
                normalize(
                  fund.title
                ) ===
                normalize(
                  name
                )
            );
        }
      }

      if (
        previous
          ?.length >
        1
      ) {
        return result(
          `Bạn muốn xem quỹ nào?\n\n${previous
            .map(
              (
                fund,
                index
              ) =>
                `${
                  index +
                  1
                }. **${fund.title}**`
            )
            .join(
              "\n"
            )}`,
          "fund",
          original,
          previous,
          sourcesOf(
            previous
          )
        );
      }

      if (
        previous
          ?.length ===
        1
      ) {
        const llm =
          await callLLM(
            buildFundPrompt(
              original,
              previous,
              context
            ),
            model_id
          );

        const candidate =
          text(
            llm
              ?.answer
          );

        const answer =
          safeAnswer(
            candidate
          ) &&
          normalize(
            candidate
          ).includes(
            normalize(
              previous[
                0
              ].title
            )
          )
            ? candidate
            : formatFunds(
                previous,
                true
              );

        return result(
          answer,
          "fund",
          previous[
            0
          ].title,
          previous,
          sourcesOf(
            previous
          ),
          llm
        );
      }
    }

    const query =
      await queryFor(
        original,
        context,
        model_id
      );

    const domain =
      fundIntent(
        original
      ) ||
      fundIntent(
        query
      )
        ? "fund"
        : "general";

    // Câu hỏi ngoài phạm vi quỹ:
    // trả lời như trợ lý LLM bình thường.
    if (
      domain ===
      "general"
    ) {
      const prompt =
        [
          "Trả lời tự nhiên bằng tiếng Việt. Dùng lịch sử, hồ sơ, dự án và nội dung file phù hợp; không ép thành danh sách quỹ, không bịa thông tin.",

          context.profile
            ? `Hồ sơ: ${text(
                context.profile
              ).slice(
                0,
                1500
              )}`
            : "",

          context.project
            ? `Dự án: ${text(
                context.project
              ).slice(
                0,
                2200
              )}`
            : "",

          scope(
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

      return result(
        text(
          llm?.answer
        ) ||
          "Tôi chưa thể trả lời lúc này.",
        "general",
        query,
        [],
        [],
        llm
      );
    }

    // Tìm CSDL trước; LLM kiểm tra
    // độ phù hợp của các ứng viên.
    const retrieved =
      normalizeFunds(
        await runFundSearch(
          query,
          model_id,
          Math.max(
            12,
            count *
              3
          )
        )
      );

    const selected =
      (
        await relevant(
          query,
          retrieved,
          model_id
        )
      ).slice(
        0,
        count
      );

    if (
      selected.length
    ) {
      const fallback =
        formatFunds(
          selected,
          detailIntent(
            original
          )
        );

      let llm =
        null;

      try {
        llm =
          await callLLM(
            buildFundPrompt(
              original,
              selected,
              context
            ),
            model_id
          );
      } catch (error) {
        console.warn(
          "Fund answer:",
          error
            ?.message ||
            error
        );
      }

      const candidate =
        text(
          llm
            ?.answer
        );

      const allNamed =
        selected.every(
          fund =>
            normalize(
              candidate
            ).includes(
              normalize(
                fund.title
              )
            )
        );

      const answer =
        safeAnswer(
          candidate
        ) &&
        allNamed
          ? candidate
          : fallback;

      remember(
        req,
        context,
        selected
      );

      return result(
        answer,
        "fund",
        query,
        selected,
        sourcesOf(
          selected
        ),
        llm
      );
    }

    // Chỉ tìm web khi CSDL không có
    // kết quả đủ phù hợp.
    let web = [];

    try {
      web =
        await webSearch(
          query
        );
    } catch (error) {
      console.warn(
        "Fund web:",
        error
          ?.message ||
          error
      );
    }

    if (
      !web.length
    ) {
      return result(
        "Chưa tìm thấy quỹ phù hợp trong CSDL và chưa xác minh được nguồn web phù hợp.",
        "fund",
        query
      );
    }

    let llm =
      null;

    try {
      llm =
        await callLLM(
          webPrompt(
            original,
            web,
            context,
            false
          ),
          model_id
        );
    } catch (error) {
      console.warn(
        "Fund web answer:",
        error
          ?.message ||
          error
      );
    }

    const candidate =
      text(
        llm
          ?.answer
      );

    const used =
      cited(
        web,
        candidate
      );

    const negative =
      /chua (xac minh|tim thay)|khong (tim thay|co thong tin|xac minh duoc)/.test(
        normalize(
          candidate
        )
      );

    if (
      !safeAnswer(
        candidate
      ) ||
      !used.length ||
      negative
    ) {
      return result(
        "Chưa xác minh được cơ hội tài trợ phù hợp từ các nguồn web tìm thấy.",
        "fund",
        query,
        [],
        [],
        llm
      );
    }

    return result(
      candidate +
        references(
          used
        ),
      "fund",
      query,
      [],
      used,
      llm
    );
  } catch (error) {
    console.error(
      "Fund service:",
      error
    );

    return result(
      "Hệ thống đang gặp lỗi, vui lòng thử lại sau.",
      "error",
      original
    );
  }
}