# RAG Assistant (FastAPI + React)

A full‑stack Retrieval‑Augmented Generation (RAG) assistant for the **finance/leasing** domain.  
Backend is **FastAPI** with MongoDB (Atlas) and OpenAI (chat + embeddings + TTS).  
Frontend is **Create React App** (CRA) with Axios.

> This README is tailored to your current repo files (e.g., `api.py`, `chat.py`, `database.py`, `embedder.py`, `ingestor.py`, `loaders.py`, `prompts.py`, `frontend/`).

---

## ✨ Features

- **Chat over your documents** with OpenAI (`gpt-4o` / `gpt-4o-mini`) and MongoDB‑backed vector search.
- **Document ingestion** for **PDF, TXT, CSV, HTML** with chunking (`RecursiveCharacterTextSplitter`).
- **Embeddings** via `text-embedding-3-small` (`langchain_openai.OpenAIEmbeddings`).
- **Conversations & messages** persisted in MongoDB.
- **Query cost estimation** (`calculate_cost.py`) storing token counts and per‑message cost.
- **Prompt engineering** helpers for multi‑query generation / context extraction (`prompts.py`).
- **TTS** endpoint (chunked for low‑latency playback); **STT** input supported by frontend mic controls.
- **CORS** enabled for local dev, simple environment‑driven config.

---

## 🧭 Repo Layout

```
.
├─ api.py                     # FastAPI app (routes, chat, docs, TTS, etc.)
├─ chat.py                    # CLI/dev utility to test retrieval + answer
├─ database.py                # Mongo client & collection helpers & allows altering database manually
├─ embedder.py                # OpenAI embeddings (text-embedding-3-small)
├─ ingestor.py                # Directory ingestion / per-file dispatch
├─ loaders.py                 # Unstructured loaders + chunking logic
├─ calculate_cost.py          # Token & cost projection
├─ prompts.py                 # Multi-query, context extraction, prompt utils
├─ requirements.txt           # Python deps
└─ frontend/                  # CRA React app (Axios client, UI, mic, TTS)
```

> **Tip:** Consider adopting the `backend/` + `frontend/` monorepo layout in a follow‑up PR (see canvas plan).

---

## 🚀 Quickstart

### 1) Prerequisites
- **Python 3.11+**
- **Node.js 18+** (CRA)
- **MongoDB Atlas** (recommended) or local MongoDB
- **OpenAI API key**

### 2) Environment variables

Create a `.env` file next to `api.py` with at least:

```bash
# FastAPI / RAG backend
OPENAI_API_KEY=sk-...
MONGO_URI=mongodb+srv://<user>:<pass>@cluster.mongodb.net/?retryWrites=true&w=majority
# Optional: override DB name (defaults to "support_assistant" in code)
# MONGODB_DB=support_assistant
```

> The code currently reads `MONGO_URI` and `OPENAI_API_KEY`. Database name defaults to `support_assistant` inside the code.

### 3) Install & run (Backend)

```bash
# 1) Create venv and install deps
python -m venv .venv && . .venv/Scripts/activate  # Windows PowerShell: .venv\Scripts\Activate.ps1
# NOTE: If you hit encoding issues on Windows with requirements.txt, open & re-save as UTF-8.
pip install -r requirements.txt

# 2) Run FastAPI (reload for dev)
python -m uvicorn backend.api:app --reload
# Docs: http://localhost:8000/docs
```

### 4) Install & run (Frontend)

```bash
cd frontend
npm install
npm start
# CRA default: http://localhost:3000
```

> Configure the frontend to call your backend at `http://localhost:8000`. If needed, add `REACT_APP_API_BASE_URL=http://localhost:8000` to `frontend/.env` and use it in your Axios client.

---

## 🧩 Architecture (High level)

```
User ↔ React (CRA) ──Axios──▶ FastAPI (api.py)
                      ▲             │
                      │             ├─ Ingest: loaders.py → split → embedder.py → MongoDB
                      │             ├─ Chat: retrieve top chunks → prompts.py → OpenAI chat
                      │             ├─ TTS: chunked text → OpenAI TTS (streamed to UI)
                      │             └─ Cost: calculate_cost.py → stored per message
                      ▼
                  Audio (Mic, TTS)
```

**Vector storage:** embeddings saved to MongoDB collection `embeddings` with a field `embedding`.  
**Conversations:** stored in `messages` and `conversations` collections.

---

## 🗂️ Document Ingestion

### Supported types
- **PDF** (UnstructuredPDFLoader)
- **TXT**
- **CSV** (UnstructuredCSVLoader)
- **HTML/HTM** (UnstructuredHTMLLoader)

### Chunking
- `RecursiveCharacterTextSplitter` with defaults: `chunk_size=500`, `chunk_overlap=100`.
- You can change defaults in `Loader(chunk_size=..., chunk_overlap=...)`.

### How to ingest
You can bulk‑ingest a folder via `ingestor.py` or use the HTTP upload endpoint.

**HTTP Upload (recommended for UI):**
- `POST /upload-document` with `multipart/form-data` (`file`).
- After upload, check status:
  - `GET /documents` (list)
  - `GET /documents/{document_id}/status`
- Delete: `DELETE /documents/{document_id}`

---

## 🧠 Embeddings & Retrieval

- Embeddings: **OpenAI `text-embedding-3-small`** via `langchain_openai.OpenAIEmbeddings` (see `embedder.py`).
- Stored as a vector in the `embeddings` collection alongside the source `content` and `metadata`.
- Retrieval performed in `api.py`/`chat.py` by fetching top‑K similar chunks and feeding them to the chat model with your system prompts.

> If using **MongoDB Atlas Vector Search**, ensure vector index is configured on `embeddings.embedding` (not included in code yet—add it via Atlas UI or a migration script).

---

## 🗣️ Chat, STT/TTS, and Costs

### Chat endpoint
- `POST /chat/{conversation_id}`
  - Body: `MessageCreate`
    ```json
    {
      "conversation_id": "<id>",
      "question": "What is leasing?",
      "is_voice_input": false,
      "voice_confidence": null,
      "audio_duration": null
    }
    ```
  - Persists both **user** and **assistant** messages.  
  - Stores `token_count` + `message_cost` via `calculate_cost.py` per the selected model.

### Conversations & Messages
- `POST /conversations` (`ConversationCreate`: `title`, `user_id`)
- `GET /conversations`
- `PUT /conversations/{conversation_id}`
- `DELETE /conversations/{conversation_id}`
- `GET /conversations/{conversation_id}/messages`

### TTS (chunked for low latency)
- `POST /voice/text-to-speech/chunk/{chunk_index}`
  - Body: `TTSRequest`:
    ```json
    {
      "text": "Your long answer here ...",
      "language": "auto",
      "voice": "nova"
    }
    ```
  - Splits text into **smart chunks** on the server; fetch sequential chunks from the client to stream audio smoothly.

### STT
- `POST /voice/transcribe` (accepts audio; the frontend mic button records and sends audio for transcription).

> There are also utility endpoints: `GET /health`, `GET /` (root), `GET /test-cost-calculation`, `POST /test-language-detection` (for debugging language auto‑detection).

---

## 🔐 CORS & Config

In `api.py`, CORS is enabled to allow your frontend origin. If the frontend runs at `http://localhost:3000`, ensure that origin is allowed by your CORS middleware configuration.

Env‑driven config to review:
- `OPENAI_API_KEY`
- `MONGO_URI`
- (Optionally) a DB name env like `MONGODB_DB` if you refactor `database.py` later.

---

## 🧪 Testing

- Add **pytest** tests in a `tests/` folder (e.g., ingestion, embedding roundtrip, endpoints).
- For the frontend, CRA includes `react-testing-library` scaffolding—start with a smoke test for the chat flow.

---


## ⚠️ Troubleshooting

- **CORS errors:** ensure your frontend origin is in the CORS list in `api.py`.
- **Mongo auth/URI:** double‑check `MONGO_URI` (Atlas SRV string recommended).
- **Windows path length:** enable long paths if you hit errors (`git config --global core.longpaths true`).
- **requirements.txt encoding:** if pip errors on Windows, open the file and re‑save as **UTF‑8** (some editors may add UTF‑16 BOM).

---

## 🗺️ Roadmap Ideas

- Switch to a `backend/` package with routers, services, and schemas modules (see canvas).
- Add Atlas Vector Index creation script.
- Streaming responses for chat (Server‑Sent Events or WebSocket).

---

## 📄 License

Choose a license (MIT/Apache‑2.0/BSD‑3‑Clause) and add a `LICENSE` file.

---

## 🙌 Acknowledgements

- LangChain community loaders (`unstructured`).
- OpenAI chat/embeddings/TTS.
- MongoDB Atlas Vector Search.
