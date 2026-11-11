"""A stdio-json example: read one ExecRequest line from stdin, write one ExecEvent per line to
stdout, and end with done. See src/protocol.ts for the message shapes."""
import json
import sys

req = json.loads(sys.stdin.readline())
text = req.get("text") or ""

if not text.strip():
    print(json.dumps({"t": "done", "result": {"ok": False, "error": "noText"}}), flush=True)
else:
    # then: follow-up actions the host executes after done (needs the paste permission in the manifest)
    print(json.dumps({"t": "done", "result": {"ok": True},
                      "then": [{"kind": "paste", "text": text.upper()}]}, ensure_ascii=False), flush=True)
