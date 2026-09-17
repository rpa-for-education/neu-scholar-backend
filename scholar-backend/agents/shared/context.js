// agents/shared/context.js

export function buildLLMContext(req) {
  const context = req.body?.context || {};

  const history = Array.isArray(context.history)
    ? context.history
        .filter(
          h =>
            h &&
            ["user", "assistant"].includes(h.role) &&
            typeof h.content === "string" &&
            h.content.trim()
        )
        .slice(-10)
    : [];

  const profile = context.user_profile || null;

  const project =
    context.project_info ||
    (context.project
      ? {
          name: context.project,
          description: ""
        }
      : null);

  const docs = Array.isArray(context.extra_data?.document)
    ? context.extra_data.document
        .filter(d => d?.text?.trim())
        .map(d => ({
          name: d.name || "document",
          text: d.text.trim()
        }))
    : [];

  return {
    history,
    profile,
    project,
    docs
  };
}