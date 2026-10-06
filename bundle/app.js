import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";

const RESPONSE_SCHEMA = {
  name: "jobguard_risk_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
      riskScore: { type: "integer", minimum: 0, maximum: 100 },
      summary: { type: "string" },
      redFlags: { type: "array", items: { type: "string" } },
      positiveSignals: { type: "array", items: { type: "string" } },
      recommendedActions: { type: "array", items: { type: "string" } },
      thingsToVerify: { type: "array", items: { type: "string" } },
    },
    required: [
      "riskLevel",
      "riskScore",
      "summary",
      "redFlags",
      "positiveSignals",
      "recommendedActions",
      "thingsToVerify",
    ],
  },
};

const SYSTEM_PROMPT = `You are JobGuard AI, an assistant that evaluates job-related messages for potential scam and fraud risk.

Analyze only the text provided. Look for requests for fees or money, sensitive or banking information, suspicious links or domains, impersonation, unrealistic salary or guaranteed employment, pressure, unclear company identity, weak interview processes, unofficial communication, suspicious software or equipment purchases, inconsistent responsibilities, and other unusual recruitment behavior.

Be conservative. Do not declare a company, recruiter, or person fraudulent. A risk assessment is not proof of fraud. Separate suspicious indicators, missing information, and positive signals. Do not invent facts about companies, people, or websites. If there is too little information, say so in the summary and recommend independent verification. Always advise the user not to share passwords, OTPs, banking credentials, card details, or similarly sensitive information.

Return one flat JSON object with exactly these keys: riskLevel, riskScore, summary, redFlags, positiveSignals, recommendedActions, thingsToVerify. Do not nest the fields inside another object. Risk score guidance: 0–30 LOW, 31–65 MEDIUM, 66–100 HIGH. A request for an upfront recruitment payment, especially with urgency, is a major risk indicator. A professional interview invitation that says no payment is required is not, by itself, suspicious. Describe evidence as potential indicators; do not state that a specific person or organization is definitely fraudulent, and do not make categorical claims such as “legitimate employers never charge fees.”`;

const INSUFFICIENT_SUMMARY = "Not enough information to confidently assess this offer. Verify the recruiter and company independently.";
const MINIMUM_MESSAGE_LENGTH = 20;

const elements = {
  textarea: document.getElementById("message-input"),
  count: document.getElementById("character-count"),
  error: document.getElementById("form-error"),
  analyze: document.getElementById("analyze-button"),
  result: document.getElementById("result-card"),
  riskBadge: document.getElementById("risk-badge"),
  summary: document.getElementById("result-summary"),
  score: document.getElementById("risk-score"),
  scoreTrack: document.querySelector(".score-track"),
  scoreFill: document.getElementById("score-fill"),
  reset: document.getElementById("reset-button"),
  status: document.getElementById("connection-status"),
};

let anna = null;

function showError(message) {
  elements.error.textContent = message;
  elements.error.hidden = false;
  elements.status.textContent = message;
}

function clearError() {
  elements.error.textContent = "";
  elements.error.hidden = true;
}

function getModelText(response) {
  if (typeof response === "string") return response;
  const content = response?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && (part.type === "text" || typeof part.text === "string"))
      .map((part) => part.text ?? "")
      .join("\n");
  }
  if (content && typeof content.text === "string") return content.text;
  if (typeof response?.text === "string") return response.text;
  if (typeof response?.output_text === "string") return response.output_text;
  const choiceText = response?.choices?.[0]?.message?.content;
  if (typeof choiceText === "string") return choiceText;
  throw new Error("The AI returned an unexpected response format.");
}

function parseModelJson(rawText) {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
      throw new Error("The AI response was not valid JSON.");
    }
    try {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    } catch {
      throw new Error("The AI response could not be read. Please try again.");
    }
  }
}

function validateAnalysis(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The AI returned an invalid assessment. Please try again.");
  }

  const assessment = value.risk_assessment ?? value.riskAssessment ?? value.analysis ?? value;
  if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) {
    throw new Error("The AI returned an invalid assessment. Please try again.");
  }

  const riskLevel = String(assessment.riskLevel ?? assessment.risk_level ?? value.riskLevel ?? value.risk_level ?? "")
    .toUpperCase()
    .replace(/\s+RISK$/, "");
  const score = Number(assessment.riskScore ?? assessment.risk_score ?? value.riskScore ?? value.risk_score);
  const redFlags = assessment.redFlags ?? assessment.red_flags ?? value.redFlags ?? value.red_flags ?? value.suspicious_indicators;
  const positiveSignals = assessment.positiveSignals ?? assessment.positive_signals ?? value.positiveSignals ?? value.positive_signals;
  const recommendedActions = assessment.recommendedActions ?? assessment.recommended_actions ?? value.recommendedActions ?? value.recommended_actions ?? value.safety_recommendations;
  const thingsToVerify = assessment.thingsToVerify ?? assessment.things_to_verify ?? value.thingsToVerify ?? value.things_to_verify ?? value.missing_information;
  const summaryText = assessment.summary ?? value.summary;
  const arrays = [redFlags, positiveSignals, recommendedActions, thingsToVerify];
  if (!["LOW", "MEDIUM", "HIGH"].includes(riskLevel) || !Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error("The AI returned an incomplete risk assessment. Please try again.");
  }
  if (typeof summaryText !== "string" || !summaryText.trim() || arrays.some((items) => items !== undefined && (!Array.isArray(items) || items.some((item) => typeof item !== "string")))) {
    throw new Error("The AI returned an incomplete risk assessment. Please try again.");
  }

  const riskScore = Math.round(score);
  const scoreLevel = riskScore <= 30 ? "LOW" : riskScore <= 65 ? "MEDIUM" : "HIGH";
  const summary = /not enough information|insufficient information|too little information/i.test(summaryText)
    ? INSUFFICIENT_SUMMARY
    : summaryText.trim();
  return {
    riskLevel: scoreLevel,
    riskScore,
    summary,
    redFlags: redFlags ?? [],
    positiveSignals: positiveSignals ?? [],
    recommendedActions: recommendedActions ?? [],
    thingsToVerify: thingsToVerify ?? [],
  };
}

function renderList(id, items, emptyMessage) {
  const list = document.getElementById(id);
  list.replaceChildren();
  const values = items.length ? items : [emptyMessage];
  values.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    if (!items.length) li.className = "empty-list-item";
    list.append(li);
  });
}

function renderAnalysis(analysis) {
  const resultTitle = document.getElementById("result-title");
  resultTitle.textContent = analysis.riskLevel === "LOW"
    ? "No major risk indicators detected"
    : "Potential risk indicators detected";
  elements.riskBadge.textContent = `${analysis.riskLevel} RISK`;
  elements.riskBadge.className = `risk-badge risk-${analysis.riskLevel.toLowerCase()}`;
  elements.summary.textContent = analysis.summary;
  elements.score.textContent = String(analysis.riskScore);
  elements.scoreTrack.setAttribute("aria-valuenow", String(analysis.riskScore));
  elements.scoreFill.style.width = `${analysis.riskScore}%`;
  elements.scoreFill.className = `score-fill score-${analysis.riskLevel.toLowerCase()}`;
  renderList("red-flags-list", analysis.redFlags, "No specific red flags were identified in the provided text.");
  renderList("positive-list", analysis.positiveSignals, "No clear positive signals were included in the provided text.");
  renderList("actions-list", analysis.recommendedActions, "Verify the recruiter and company independently before proceeding.");
  renderList("verify-list", analysis.thingsToVerify, "Confirm the role and recruiter through the company's official channels.");
  elements.result.hidden = false;
  elements.result.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function requestAnalysis(message) {
  const request = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: message,
          },
        ],
      },
    ],
    temperature: 0.2,
    maxTokens: 900,
  };

  try {
    return await anna.llm.complete({
      ...request,
      responseFormat: {
        type: "json_schema",
        json_schema: RESPONSE_SCHEMA,
      },
    });
  } catch (error) {
    const reason = String(error?.message ?? error).toLowerCase();

    if (
      !/response.?format|json.?schema|structured.?output|unsupported format/.test(
        reason
      )
    ) {
      throw error;
    }

    return anna.llm.complete({
      ...request,
      responseFormat: {
        type: "json_object",
      },
    });
  }
}

async function analyzeMessage() {
  const message = elements.textarea.value.trim();
  clearError();
  if (!message) {
    showError("Please paste a job-related message to analyze.");
    elements.textarea.focus();
    return;
  }
  if (message.length < MINIMUM_MESSAGE_LENGTH) {
    showError("Please paste a longer job-related message so there is enough context to analyze.");
    elements.textarea.focus();
    return;
  }
  if (!anna) {
    showError("Anna AI is not connected. Open this app through the Anna local development environment and try again.");
    return;
  }

  elements.analyze.disabled = true;
  elements.analyze.classList.add("is-loading");
  elements.analyze.querySelector("span:last-child").textContent = "Analyzing securely…";
  elements.result.hidden = true;
  elements.status.textContent = "Analyzing your message.";
  try {
    const response = await requestAnalysis(message);
    const analysis = validateAnalysis(parseModelJson(getModelText(response)));
    renderAnalysis(analysis);
    elements.status.textContent = `Analysis complete. ${analysis.riskLevel} risk, score ${analysis.riskScore} out of 100.`;
  } catch (error) {
    console.error("JobGuard analysis failed:", error);
    const messageText = String(error?.message ?? error);
    if (/not enough information/i.test(messageText)) {
      showError(INSUFFICIENT_SUMMARY);
    } else if (/not valid json|could not be read|unexpected response|incomplete risk assessment|invalid assessment/i.test(messageText)) {
      showError("We couldn't read the AI assessment. Your message is still here—please try again.");
    } else {
      showError("Analysis couldn't be completed right now. Please try again in a moment.");
    }
  } finally {
    elements.analyze.disabled = false;
    elements.analyze.classList.remove("is-loading");
    elements.analyze.querySelector("span:last-child").textContent = "Analyze for Risk";
  }
}

async function main() {
  elements.textarea.addEventListener("input", () => {
    elements.count.textContent = `${elements.textarea.value.length.toLocaleString()} / 12,000`;
    if (!elements.error.hidden) clearError();
  });
  elements.analyze.addEventListener("click", analyzeMessage);
  elements.textarea.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") analyzeMessage();
  });
  elements.reset.addEventListener("click", () => {
    elements.textarea.value = "";
    elements.count.textContent = "0 / 12,000";
    elements.result.hidden = true;
    clearError();
    elements.textarea.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  try {
    anna = await AnnaAppRuntime.connect();
    await anna.window.set_title({ title: "JobGuard AI" });
    elements.status.textContent = "Anna AI is ready.";
  } catch (e) {
    elements.status.textContent = "Anna AI is not connected. Open this app in the Anna development environment to analyze messages.";
  }
}

main();
