"""JobGuard AI Executa plugin.

Analyzes job and recruitment messages for potential scam indicators
using Anna's reverse sampling capability.
"""

from __future__ import annotations

import json
import sys
import uuid
from typing import Any


MANIFEST: dict[str, Any] = {
    "display_name": "JobGuard AI",
    "version": "0.1.0",
    "description": (
        "AI-powered job scam detection tool that analyzes "
        "recruitment messages for suspicious signals."
    ),
    "host_capabilities": ["llm.sample"],
    "tools": [
        {
            "name": "analyze_job_message",
            "description": (
                "Analyze a job or recruitment message for potential "
                "scam indicators and provide safety recommendations."
            ),
            "parameters": [
                {
                    "name": "message",
                    "type": "string",
                    "description": "The job or recruitment message to analyze.",
                    "required": True,
                }
            ],
        }
    ],
}


def _write(envelope: dict[str, Any]) -> None:
    """Write a JSON-RPC message to stdout."""
    sys.stdout.write(json.dumps(envelope) + "\n")
    sys.stdout.flush()


def _request_sampling(prompt: str) -> dict[str, Any]:
    """Ask the Anna host to analyze the message using reverse sampling."""

    request_id = str(uuid.uuid4())

    _write(
        {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": "sampling/createMessage",
            "params": {
                "messages": [
                    {
                        "role": "user",
                        "content": {
                            "type": "text",
                            "text": prompt,
                        },
                    }
                ],
                "maxTokens": 700,
            },
        }
    )

    for line in sys.stdin:
        line = line.strip()

        if not line:
            continue

        envelope = json.loads(line)

        if envelope.get("id") == request_id and "method" not in envelope:
            if "error" in envelope:
                raise RuntimeError(
                    envelope["error"].get(
                        "message",
                        "Sampling request failed.",
                    )
                )

            return envelope.get("result", {})

        _dispatch(envelope)

    raise RuntimeError(
        "stdin closed before sampling response was received."
    )


def _build_prompt(message: str) -> str:
    """Create the JobGuard AI analysis prompt."""

    return f"""
You are JobGuard AI, a job-safety assistant.

Analyze the following job or recruitment message for potential
scam or fraudulent recruitment indicators.

JOB MESSAGE:
--------------------
{message}
--------------------

Look for warning signs including:

- Requests for upfront fees or payments
- Requests for bank details, passwords, OTPs, or sensitive information
- Unrealistic salary or benefits
- Fake or suspicious recruiter communication
- Suspicious email addresses or links
- Urgent or threatening language
- Job offers without a normal interview process
- Requests to communicate through suspicious channels
- Unrealistic work-from-home claims
- Requests for cryptocurrency, gift cards, or unusual payments
- Other unusual recruitment patterns

Return the analysis using this structure:

Risk Level: [LOW / MEDIUM / HIGH]

Verdict:
[One short sentence explaining the overall assessment.]

Detected Signals:
- [signal 1]
- [signal 2]
- [signal 3]

Safety Recommendations:
- [recommendation 1]
- [recommendation 2]
- [recommendation 3]

Important:
Do not claim that a message is definitely a scam unless the evidence
is conclusive. Explain that users should independently verify recruiters,
companies, job postings, links, and offers before sharing sensitive
information or making payments.
""".strip()


def analyze_job_message(message: str) -> dict[str, Any]:
    """Analyze a recruitment message using Anna LLM."""

    if not message.strip():
        return {
            "success": False,
            "error": "Job message is required.",
        }

    try:
        prompt = _build_prompt(message)
        sample = _request_sampling(prompt)

        content = sample.get("content", {})
        analysis = content.get("text", "")

        if not analysis:
            return {
                "success": False,
                "error": "The AI returned an empty analysis.",
            }

        return {
            "success": True,
            "data": {
                "analysis": analysis,
            },
        }

    except Exception as exc:
        return {
            "success": False,
            "error": f"Analysis failed: {exc}",
        }


def invoke(method: str, args: dict[str, Any]) -> dict[str, Any]:
    """Execute a JobGuard AI tool."""

    if method == "analyze_job_message":
        message = args.get("message", "")
        return analyze_job_message(message)

    return {
        "success": False,
        "error": f"Unknown tool: {method}",
    }


def _dispatch(envelope: dict[str, Any]) -> None:
    """Dispatch incoming JSON-RPC requests."""

    method = envelope.get("method")
    request_id = envelope.get("id")

    try:
        if method == "initialize":
            result = {
                "protocolVersion": "2.0",
                "server_info": {
                    "name": MANIFEST["display_name"],
                    "version": MANIFEST["version"],
                },
                "capabilities": {
                    "sampling": {},
                },
            }

        elif method == "describe":
            result = MANIFEST

        elif method == "health":
            result = {
                "status": "ready",
            }

        elif method == "invoke":
            params = envelope.get("params", {})

            result = invoke(
                params.get("tool", ""),
                params.get("arguments", {}),
            )

        else:
            raise ValueError(f"Unknown RPC method: {method}")

        _write(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": result,
            }
        )

    except Exception as exc:
        _write(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {
                    "code": -32601,
                    "message": str(exc),
                },
            }
        )


def main() -> None:
    """Start the JSON-RPC stdin/stdout server."""

    for line in sys.stdin:
        line = line.strip()

        if not line:
            continue

        _dispatch(json.loads(line))


if __name__ == "__main__":
    main()