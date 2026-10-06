# JobGuard AI

JobGuard AI uses Anna's built-in LLM to assess job-related messages for potential scam indicators. Analysis is performed on demand; messages are not saved by the app.

## Run locally

From this project directory:

```bash
anna-app validate --strict
anna-app dev
```

The local Anna harness opens at `http://127.0.0.1:5180`. `anna-app dev` without `--mock-llm` uses the real Anna LLM bridge and analyzes each submitted message; no external model API key is needed. If needed, sign in first with `anna-app login --host <Anna-Nexus-URL>` and make sure the account can use the built-in LLM.

To test deterministically without a live model, run one of these separate harness commands:

```bash
anna-app dev --mock-llm fixtures/high-risk.jsonl  # fixed HIGH RISK response
anna-app dev --mock-llm fixtures/low-risk.jsonl   # fixed LOW RISK response
anna-app dev --mock-llm fixtures/malformed.jsonl  # malformed response handling
```

Each mock command returns its fixture response by design; it does not evaluate the entered text. Stop one harness before starting another. For dynamic analysis of different inputs, use `anna-app dev` with no `--mock-llm` option and an authenticated Anna account.

## How it works

- `bundle/index.html` and `bundle/styles.css` provide the responsive interface.
- `bundle/app.js` calls `anna.llm.complete`, requests a JSON-schema response, validates the result, and renders it without storing the source message.
- `manifest.json` grants only the Anna LLM completion capability and window title API.

The score is an informational risk assessment, not proof that a company or recruiter is fraudulent. Independently verify all offers and never share passwords, one-time codes, banking credentials, or card details.
