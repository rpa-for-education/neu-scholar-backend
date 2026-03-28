import session from "express-session";

export const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "fitsecret",
  resave: false,
  saveUninitialized: true,
});

const MAX_HISTORY = 5;

export function getSessionHistory(req) {
  if (!req.session.history) {
    req.session.history = [];
  }
  return req.session.history;
}

export function addToHistory(req, question, answer) {
  const history = getSessionHistory(req);

  history.push({ role: "user", content: question });
  history.push({ role: "assistant", content: answer });

  if (history.length > MAX_HISTORY * 2) {
    history.splice(0, history.length - MAX_HISTORY * 2);
  }
}