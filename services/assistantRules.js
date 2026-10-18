// Deterministic intent matching: cheap, predictable, and the fallback when the
// language model is unavailable. Returns { tool, params } or null.
const svc = require("./reportService");

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const FULL = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function extractMonths(text, now) {
  const cur = svc.parseMonth(svc.currentMonthKey(now));
  const found = [];
  const re = new RegExp(
    `\\b(this month|last month|previous month|prior month|(\\d{4})-(0[1-9]|1[0-2])|(${FULL.join("|")}|${MONTHS.join("|")})(?:\\s+(20\\d{2}))?)\\b`,
    "g"
  );
  let m;
  while ((m = re.exec(text))) {
    if (m[1] === "this month") found.push(svc.monthKey(cur.year, cur.month));
    else if (/^(last|previous|prior) month$/.test(m[1])) found.push(svc.shiftMonth(cur, -1));
    else if (m[2]) found.push(`${m[2]}-${m[3]}`);
    else {
      const idx = FULL.indexOf(m[4]) >= 0 ? FULL.indexOf(m[4]) : MONTHS.indexOf(m[4]);
      let year = m[5] ? Number(m[5]) : cur.year;
      // "in December" said in March means last December, not a future month.
      if (!m[5] && idx + 1 > cur.month) year -= 1;
      found.push(svc.monthKey(year, idx + 1));
    }
  }
  return found;
}

function extractYear(text, now) {
  const cur = svc.parseMonth(svc.currentMonthKey(now));
  if (/\bthis year\b/.test(text)) return String(cur.year);
  if (/\b(last|previous) year\b/.test(text)) return String(cur.year - 1);
  const m = /\b(20\d{2})\b(?!-)/.exec(text);
  return m ? m[1] : null;
}

function period(text, now) {
  const months = extractMonths(text, now);
  if (months.length) return { month: months[0] };
  const year = extractYear(text, now);
  return year ? { year } : {};
}

function hasPeriod(text, now) {
  return extractMonths(text, now).length > 0 || !!extractYear(text, now);
}

function matchIntent(message, context, now = new Date()) {
  const t = message.toLowerCase().replace(/[?!.,]/g, " ").replace(/\s+/g, " ").trim();
  const cur = svc.parseMonth(svc.currentMonthKey(now));
  const months = extractMonths(t, now);
  // A YYYY-MM-looking token that isn't a real month must not silently become "this month".
  if (/\b\d{4}-\d{2}\b/.test(t) && !/\b\d{4}-(0[1-9]|1[0-2])\b/.test(t)) return null;

  if (/\b(predict|forecast|projection|project|expect|estimate)\b|\bnext (\d+ |three |3 )?months?\b|next quarter/.test(t)) {
    return { tool: "forecast", params: { horizon: /\b(3|three) months\b|quarter/.test(t) ? 3 : 1 } };
  }
  const revenueWord = /\b(revenue|income|earnings?|sales)\b/.test(t);
  if (/\b(why|reason|explain|cause)\b/.test(t) || (revenueWord && /\b(decrease[d]?|decline[d]?|drop(ped)?|fell|fall|increase[d]?|rose|grew)\b/.test(t))) {
    return { tool: "explainChange", params: months.length ? { month: months[0] } : {} };
  }
  if (/\b(compare|comparison|versus|vs|difference)\b/.test(t)) {
    if (months.length >= 2) return { tool: "compareMonths", params: { monthA: months[0], monthB: months[1] } };
    const a = months[0] || svc.monthKey(cur.year, cur.month);
    return { tool: "compareMonths", params: { monthA: a, monthB: svc.shiftMonth(svc.parseMonth(a), -1) } };
  }
  if (/\bdoctors?\b/.test(t) && /\b(highest|most|top|best|generated|biggest)\b/.test(t)) {
    return { tool: "topDoctor", params: period(t, now) };
  }
  if (/\bcommission\b/.test(t)) return { tool: "centerCommission", params: period(t, now) };
  if (/\b(highest|best|top|peak|biggest)\b.*\bmonth\b|\bmonth\b.*\b(highest|best|peak)\b/.test(t)) {
    return { tool: "bestMonth", params: {} };
  }
  if (/\b(how many|number of|count)\b.*\b(appointments?|visits?|paid|sessions?)\b|\bsuccessfully paid\b/.test(t)) {
    return { tool: "paidAppointmentCount", params: period(t, now) };
  }
  if (/\b(revenue|income|earn(ed|ings)?|sales|total)\b/.test(t)) return { tool: "monthRevenue", params: period(t, now) };

  // Follow-up like "and last month?" / "what about March?": reuse the previous tool.
  if (context && context.tool && hasPeriod(t, now) && !["forecast", "bestMonth", "compareMonths"].includes(context.tool)) {
    return { tool: context.tool, params: period(t, now) };
  }
  return null;
}

module.exports = { matchIntent, extractMonths };
