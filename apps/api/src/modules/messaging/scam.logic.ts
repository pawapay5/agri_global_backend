/**
 * Heuristic scam detection for marketplace chat. It flags; it does not silently drop messages.
 * High-risk messages are delivered with a safety banner, and the conversation is queued for moderation.
 * Patterns are deliberately conservative to keep false positives low for ordinary trade talk.
 */

export interface ScamResult { score: number; flags: string[]; action: "allow" | "warn" | "hold" }

const RULES: { flag: string; weight: number; re: RegExp }[] = [
  // Asking to pay outside the platform (the main fraud vector with escrow).
  { flag: "off_platform_payment", weight: 0.6, re: /\b(pay|send|transfer)\b[^.\n]{0,40}\b(direct(ly)?|outside|off)\b[^.\n]{0,25}\b(app|platform|agriprice)\b/i },
  { flag: "off_platform_payment", weight: 0.6, re: /\b(send|pay|transfer)\b[^.\n]{0,30}\b(momo|mobile money|airtel ?tigo|telecel cash|vodafone cash|mtn)\b[^.\n]{0,30}\b(number|no\.?|to me|0\d{9})/i },
  { flag: "off_platform_payment", weight: 0.5, re: /\b(western union|moneygram|gift ?cards?|bitcoin|usdt|crypto)\b/i },
  { flag: "advance_payment_pressure", weight: 0.3, re: /\b(pay|deposit|advance)\b[^.\n]{0,30}\b(before|first|upfront|in advance)\b/i },
  // Credential/OTP harvesting: never legitimate between users.
  { flag: "credential_request", weight: 0.9, re: /\b(otp|one[- ]time (code|pin)|verification code|pin code|momo pin|send (me )?(the )?code)\b/i },
  { flag: "external_contact", weight: 0.2, re: /\b(whats ?app|telegram|signal)\b|wa\.me\/|t\.me\//i },
  { flag: "phone_number", weight: 0.15, re: /(\+?\d[\d\s-]{8,}\d)/ },
  { flag: "suspicious_link", weight: 0.35, re: /\bhttps?:\/\/(?!([\w-]+\.)*agriprice\.app)(bit\.ly|tinyurl|[\w-]+\.(xyz|top|click|link|ru))\b/i },
  { flag: "urgency", weight: 0.1, re: /\b(urgent(ly)?|right now|immediately|today only|last chance)\b/i },
];

export function scanMessage(text: string): ScamResult {
  const flags = new Set<string>();
  let score = 0;
  for (const r of RULES) {
    if (r.re.test(text) && !flags.has(r.flag)) { flags.add(r.flag); score += r.weight; }
  }
  score = Math.min(1, Math.round(score * 100) / 100);
  const action = flags.has("credential_request") || score >= 0.8 ? "hold" : score >= 0.5 ? "warn" : "allow";
  return { score, flags: [...flags], action };
}

/** Sliding-window rate limit decision (counts supplied by Redis). */
export function messageRateOk(sentLastMinute: number, sentLastHour: number, newConversationsLastDay: number, isNewConversation: boolean) {
  if (sentLastMinute >= 20) return { ok: false, code: "rate_minute" };
  if (sentLastHour >= 300) return { ok: false, code: "rate_hour" };
  if (isNewConversation && newConversationsLastDay >= 30) return { ok: false, code: "rate_new_conversations" };
  return { ok: true as const };
}
