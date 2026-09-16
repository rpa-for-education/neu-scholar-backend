// agents/shared/memory.js

const MAX_HISTORY_ITEMS = 10;
const MAX_CONTENT_LENGTH = 4000;

// ================= NORMALIZE =================
export function normalizeHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .filter(
      item =>
        item &&
        ["user", "assistant"].includes(item.role) &&
        typeof item.content === "string" &&
        item.content.trim()
    )
    .map(item => ({
      role: item.role,
      content: item.content
        .trim()
        .slice(0, MAX_CONTENT_LENGTH)
    }))
    .slice(-MAX_HISTORY_ITEMS);
}

// ================= GET RECENT USER CONTEXT =================
export function getRecentUserContext(history = []) {
  const normalized = normalizeHistory(history);

  return normalized
    .filter(item => item.role === "user")
    .slice(-3)
    .map(item => item.content)
    .join("\n");
}

// ================= BUILD SEARCH QUESTION =================
export function buildContextualQuestion(question, history = []) {
  const previousContext = getRecentUserContext(history);

  if (!previousContext) {
    return question;
  }

  return `
Ngữ cảnh hội thoại trước:
${previousContext}

Câu hỏi hiện tại:
${question}
`.trim();
}