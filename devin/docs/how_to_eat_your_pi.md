# How to Eat Your Pi

Deploy pi as a Python service using RPC subprocess mode.

## Mental Model

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Python App                          │
│                                                               │
│   FastAPI / Flask / Django ── WebSocket / SSE ── Frontend     │
│           │                                                      │
│           │ spawn                                               │
│           ▼                                                      │
│   ┌─────────────────┐                                          │
│   │  pi --mode rpc  │  ◄── Node.js binary, called as CLI       │
│   │  (subprocess)   │                                          │
│   └────────┬────────┘                                          │
│            │ stdin/stdout (JSONL)                               │
└────────────┼───────────────────────────────────────────────────
             │
             ▼
      JSON events stream
      to Python as they
      happen
```

**pi is not a server.** It's a subprocess you spawn and control from Python. Think `git`, `docker`, `ffmpeg` — command-line tools called from code.

## Why RPC Subprocess?

| Approach | Use Case |
|----------|----------|
| **SDK** (`npm install @mariozechner/pi-coding-agent`) | Node.js apps — import directly |
| **RPC Subprocess** | Python apps, other languages — spawn as CLI |
| **Interactive TUI** | Human-in-loop coding (dev mode) |
| **Binary** | Deploy pi without Node.js dependency |

If your backend is Python, RPC subprocess is the path. No `pip install pi` — you call the `pi` binary.

## Multiple Personas

Each persona is a different config directory:

```
~/.pi/
├── devin/              # Devin's agent
│   ├── extensions/
│   ├── skills/
│   ├── agents/
│   └── settings.json
│
├── mary/               # Mary's agent
│   ├── extensions/
│   ├── skills/
│   └── settings.json
│
└── cindy/              # Cindy's agent
    └── ...
```

Spawn each with its own `--agent-dir`:

```python
from subprocess import Popen, PIPE
import json

class PiAgent:
    def __init__(self, persona: str = "default"):
        self.agent_dir = f"~/.pi/{persona}/"
        self.proc = Popen(
            ["pi", "--mode", "rpc", "--agent-dir", self.agent_dir, "--no-session"],
            stdin=PIPE,
            stdout=PIPE,
            stderr=PIPE,
            text=True
        )
    
    def send(self, cmd: dict):
        self.proc.stdin.write(json.dumps(cmd) + "\n")
        self.proc.stdin.flush()
    
    def events(self):
        for line in self.proc.stdout:
            yield json.loads(line)
    
    def close(self):
        self.proc.terminate()
```

## Basic Usage

```python
async def stream_chat(websocket, message: str, persona: str = "default"):
    agent = PiAgent(persona)
    
    # Send prompt
    agent.send({"type": "prompt", "message": message})
    
    # Stream events to websocket
    for event in agent.events():
        if event.get("type") == "message_update":
            delta = event.get("assistantMessageEvent", {})
            if delta.get("type") == "text_delta":
                await websocket.send_text(delta["delta"])
        
        elif event.get("type") == "agent_end":
            break
    
    agent.close()
```

## Event Types to Handle

| Event | When | What to Do |
|-------|------|------------|
| `message_update` + `text_delta` | Streaming text | Send to frontend |
| `message_update` + `thinking_delta` | Model thinking | Optional: stream thinking |
| `tool_execution_start` | Tool starts | Optional: show "running..." |
| `tool_execution_end` | Tool done | Optional: show result |
| `agent_end` | Done | Close stream, save session |
| `extension_ui_request` | Agent needs input | Respond with `extension_ui_response` |

## REST API Pattern (FastAPI)

```python
from fastapi import FastAPI, WebSocket
from fastapi.responses import StreamingResponse
import asyncio

app = FastAPI()
agents = {}  # user_id -> PiAgent

def get_agent(user_id: str) -> PiAgent:
    if user_id not in agents:
        persona = get_persona_for(user_id)  # Devin? Mary? Cindy?
        agents[user_id] = PiAgent(persona)
    return agents[user_id]

@app.websocket("/chat/{user_id}")
async def chat(websocket: WebSocket, user_id: str):
    await websocket.accept()
    agent = get_agent(user_id)
    
    # Stream events as they arrive
    async def event_stream():
        for event in agent.events():
            yield json.dumps(event) + "\n"
    
    try:
        # Start streaming in background
        stream_task = asyncio.create_task(
            stream_events_to_websocket(websocket, agent)
        )
        
        # Handle incoming messages
        while True:
            data = await websocket.receive_text()
            agent.send({"type": "prompt", "message": data})
            
    except Exception:
        pass
    finally:
        stream_task.cancel()
        agent.close()
```

## WebSocket Streaming Helper

```python
async def stream_events_to_websocket(websocket, agent):
    for event in agent.events():
        # Text streaming
        if event.get("type") == "message_update":
            delta = event.get("assistantMessageEvent", {})
            if delta.get("type") == "text_delta":
                await websocket.send_text(delta["delta"])
        
        # Thinking (optional)
        elif event.get("type") == "message_update":
            thinking = event.get("assistantMessageEvent", {})
            if thinking.get("type") == "thinking_delta":
                await websocket.send_json({"type": "thinking", "text": thinking["delta"]})
        
        # Tool execution UI
        elif event.get("type") == "tool_execution_start":
            await websocket.send_json({
                "type": "tool",
                "status": "start",
                "tool": event["toolName"],
                "args": event["args"]
            })
        
        elif event.get("type") == "tool_execution_end":
            await websocket.send_json({
                "type": "tool",
                "status": "end",
                "tool": event["toolName"],
                "result": event["result"]
            })
        
        # Done
        elif event.get("type") == "agent_end":
            break
```

## Extension UI (Confirm/Select/Input)

Agents may request user input via extension commands:

```python
async def handle_extension_request(event, websocket):
    request = event  # extension_ui_request
    method = request["method"]
    
    if method in ("select", "confirm", "input", "editor"):
        # Forward to frontend
        await websocket.send_json(request)
        
        # Wait for response
        response = await websocket.receive_json()
        
        # Send back to pi
        agent.send({
            "type": "extension_ui_response",
            "id": request["id"],
            **response
        })
```

## Session Persistence

```python
def __init__(self, persona: str, session_file: str = None):
    cmd = ["pi", "--mode", "rpc", "--agent-dir", self.agent_dir]
    
    if session_file:
        cmd.extend(["--session", session_file])
    else:
        cmd.append("--no-session")
    
    self.proc = Popen(cmd, ...)
```

- **With session**: Conversations persist across requests (chat history)
- **Without session**: Fresh start each time (stateless)

## Key Commands (via `send()`)

```python
# Send a prompt
agent.send({"type": "prompt", "message": "Hello"})

# Abort current operation
agent.send({"type": "abort"})

# Start fresh session
agent.send({"type": "new_session"})

# Switch models
agent.send({"type": "set_model", "provider": "anthropic", "modelId": "claude-opus-4-5"})

# Set thinking level
agent.send({"type": "set_thinking_level", "level": "high"})
```

## Tools vs Commands

| | Commands | Tools |
|---|---|---|
| Who calls them | Human (slash interface) | LLM/Agent |
| In your API | Send as prompt: `/doThing` | LLM calls automatically |
| Your control | Pass through to pi | LLM decides during run |

For a service, tools are more relevant — the agent calls them autonomously. Commands are UX sugar for interactive mode.

## Putting It Together

```python
# pi_service.py
import json
import asyncio
from subprocess import Popen, PIPE
from fastapi import FastAPI, WebSocket
from fastapi.responses import StreamingResponse

class PiAgent:
    def __init__(self, persona: str, cwd: str = None, session_file: str = None):
        self.agent_dir = f"~/.pi/{persona}/"
        cmd = ["pi", "--mode", "rpc", "--agent-dir", self.agent_dir]
        if cwd:
            cmd.extend(["--cwd", cwd])
        if session_file:
            cmd.extend(["--session", session_file])
        else:
            cmd.append("--no-session")
        
        self.proc = Popen(cmd, stdin=PIPE, stdout=PIPE, stderr=PIPE, text=True)
        self.pending_requests = {}
    
    def send(self, cmd: dict):
        self.proc.stdin.write(json.dumps(cmd) + "\n")
        self.proc.stdin.flush()
    
    def events(self):
        for line in self.proc.stdout:
            if line.strip():
                yield json.loads(line)
    
    def close(self):
        self.proc.terminate()
        self.proc.wait()

# FastAPI app
app = FastAPI()
sessions = {}  # user_id -> PiAgent

@app.websocket("/ws/chat/{user_id}")
async def chat(websocket: WebSocket, user_id: str):
    await websocket.accept()
    
    # Get or create agent for this user
    if user_id not in sessions:
        persona = user_persona_map.get(user_id, "default")
        sessions[user_id] = PiAgent(persona)
    
    agent = sessions[user_id]
    
    # Task 1: Stream events to frontend
    async def stream():
        for event in agent.events():
            await websocket.send_text(json.dumps(event))
    
    stream_task = asyncio.create_task(stream())
    
    # Task 2: Forward user messages to agent
    try:
        while True:
            message = await websocket.receive_text()
            agent.send({"type": "prompt", "message": message})
    except Exception:
        pass
    finally:
        stream_task.cancel()
        # Optionally close, or keep session alive
        # agent.close()
        # del sessions[user_id]

@app.post("/chat/{user_id}")
async def chat_post(user_id: str, message: str):
    agent = sessions.get(user_id)
    if not agent:
        persona = user_persona_map.get(user_id, "default")
        agent = PiAgent(persona, session_file=f"/sessions/{user_id}.jsonl")
        sessions[user_id] = agent
    
    results = []
    agent.send({"type": "prompt", "message": message})
    
    for event in agent.events():
        if event.get("type") == "message_update":
            delta = event.get("assistantMessageEvent", {})
            if delta.get("type") == "text_delta":
                results.append(delta["delta"])
        elif event.get("type") == "agent_end":
            break
    
    return {"response": "".join(results)}
```

## What's pi Handling

- LLM interaction
- Tool execution
- Session state
- Chain orchestration
- Context compaction
- Model routing

## What's Your Python Handling

- HTTP/WebSocket transport
- User authentication
- Session management per user
- Frontend UI
- Error handling
- Scaling (multiple processes, load balancing)

## Further Reading

- [SDK Docs](./sdk.md) — Node.js SDK for direct import
- [RPC Protocol](./rpc.md) — Full JSON protocol spec
- [Extensions](./extensions.md) — Build custom tools, commands, hooks
- [Skills](./skills/) — Policy files that guide agent behavior
- [Agents](./agents/) — Sub-agent definitions
- [Chains](./agent-chain.yaml) — Multi-agent pipelines
- [pi-patterns/](../pi-patterns) — Architectural patterns from the video course
