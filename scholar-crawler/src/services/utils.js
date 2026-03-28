import crypto from "crypto";

export const genKey = (v) =>
  crypto.createHash("md5").update(String(v)).digest("hex");

export const clean = (v) =>
  typeof v === "string" ? v.trim() || null : v ?? null;

export const parseNum = (v) => {
  if (!v) return null;
  const n = Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
};

export const stripHTML = (html) =>
  html ? html.replace(/<[^>]*>/g, "").trim() : null;