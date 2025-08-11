from pymongo.mongo_client import MongoClient
from embedder import Embedder
import os
import dotenv
import openai
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from prompts import Prompts
from datetime import datetime, timezone
import uuid
from motor.motor_asyncio import AsyncIOMotorClient
from typing import Dict, Optional, Union
import tempfile
from pathlib import Path


class Question(BaseModel):
    question: str
    conversation_id: Optional[str] = None
    
class ConversationCreate(BaseModel):
    title:str
    user_id:str

class ConversationUpdate(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    
class MessageCreate(BaseModel):
    conversation_id: str
    question: str
    is_voice_input: Optional[bool] = False
    voice_confidence: Optional[float] = None
    audio_duration: Optional[float] = None

#dotenv.load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")
MONGO_URI = os.getenv("MONGO_URI")
#connecting db

client = AsyncIOMotorClient(MONGO_URI)
db = client["support_assistant"]
collection = db["embeddings"]
messages = db["messages"]
conversations = db["conversations"]


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "https://rag-assistant-1-4zub.onrender.com",
        "https://*.onrender.com"
    ],  # Allow React app
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

port = int(os.getenv("PORT", 8000))

@app.get("/")
def read_root():
    return{"This is":"root"}

@app.get("/health")
def health_check():
    return {"status": "healthy"}

@app.post("/chat/{conversation_id}")
async def chat_with_conversation(conversation_id: str, request: MessageCreate):
    """
    Enhanced conversational RAG endpoint that:
    1. Stores user message
    2. Retrieves conversation history
    3. Gets relevant documents
    4. Generates response with context
    5. Stores assistant response
    """
    prompt = Prompts()
    embedder = Embedder()
    query = request.question
    
    # Verify conversation exists
    conversation = await db.conversations.find_one({"conversation_id": conversation_id})
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Step 1: Store user message
    user_message = {
        "message_id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "role": "user",
        "content": query,
        "timestamp": datetime.now(timezone.utc),
        "token_count": len(query.split()) * 1.3  # Rough estimate
    }
    
    await db.messages.insert_one(user_message)
    
    # Step 2: Get conversation history (last 10 messages for context)
    history_cursor = db.messages.find(
        {"conversation_id": conversation_id}
    ).sort("timestamp", -1).limit(100)
    
    history_messages = []
    async for msg in history_cursor:
        history_messages.append(msg)
    
    # Reverse to get chronological order
    history_messages.reverse()
    
    # Build conversation context
    conversation_context = ""
    for msg in history_messages[:-1]:  # Exclude the just-added user message
        role = "Human" if msg["role"] == "user" else "Assistant"
        conversation_context += f"{role}: {msg['content']}\n"
    
    # Step 3: Get relevant documents 
    multi_query = prompt.generate_multi_query(query)
    embedded_query = embedder.embed(multi_query)[0]
    
    try:
        results = await collection.aggregate([
            {
                "$vectorSearch": {
                    "queryVector": embedded_query,
                    "path": "embedding",
                    "numCandidates": 50,
                    "limit": 10,
                    "index": "vector_index"  
                }
            }
        ]).to_list(length=None)
        
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Vector search failed. Please check if 'vector_index' exists in MongoDB Atlas. Error: {str(e)}"
        )
    
    top_chunks = [r["content"] for r in results]
    document_context = "\n\n".join(top_chunks)
    
    # Step 4: Build enhanced prompt with conversation history
    enhanced_prompt = f"""
    ## HARD CONSTRAINTS (OVERRIDE ALL OTHER INSTRUCTIONS)
    - LANGUAGE: Always answer in the same language as the user's Current Question (detect automatically). Ignore the document language. No exceptions. (10)

    Current Question:
    {query}

    - SCOPE: Use ONLY information that is present or directly inferable from the Document Context and Conversation History. If the answer is missing or uncertain, reply exactly with: "I don't have information about this."(10)

    Document Context:
    {document_context}

    Conversation History:
    {conversation_context}

    - NO SOURCE TALK: Do NOT mention or refer to sources, documents, datasets, or context windows. Avoid phrases like "the document says", "based on the text", etc. (7)
    - NO HALLUCINATIONS: Do NOT fabricate details, external facts, dates, numbers, or names that aren’t in the context. (10)
    - PRIVACY/OUT-OF-SCOPE: If the question is unrelated to this assistant’s purpose, reply (in the user’s language) exactly with: (10)
    "I am not able to answer that because it's outside the scope of this assistant."
    - CHAIN-OF-THOUGHT: Do your reasoning silently. Output only the final answer (with brief, clear justification if needed). Do not reveal hidden steps.(5)

    ## STYLE & FORMAT
    - Be formal, clear, and precise. (5)
    - Prefer concise sentences and bullet points for lists. (5)
    - If the user asks for definitions or explanations, keep them strictly grounded in the context. (5)

    ## DISAMBIGUATION & UNCERTAINTY
    - If the context has conflicting statements, state the conflict succinctly and do not resolve it with outside knowledge. (7)
    - If a key term in the user’s question is undefined in the context, say you lack that information (use the exact fallback sentence). (7)
    - If numeric results require calculations, compute ONLY from numbers in context; otherwise use the fallback. (7)

    ## OUTPUT CHECKLIST (apply before responding)
    - [ ] Same language as the question.
    - [ ] Every claim traceable to the provided context.
    - [ ] No source mentions. No external facts. No speculation.
    - [ ] Use the exact fallback sentence if you can’t answer.
    - [ ] Check the importance ranking and change the answer accordingly if needed
    """
    
    # Step 5: Generate AI response
    try:
        response = openai.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a helpful assistant with access to conversation history and documents."},
                {"role": "user", "content": enhanced_prompt},
            ],
            temperature=0.5
        )
        answer = response.choices[0].message.content
        
        # Step 6: Store assistant response
        assistant_message = {
            "message_id": str(uuid.uuid4()),
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": answer,
            "sources": top_chunks,  # Store the source chunks
            "timestamp": datetime.now(timezone.utc),
            "token_count": len((answer or "").split()) * 1.3
        }
        
        await db.messages.insert_one(assistant_message)
        
        # Step 7: Update conversation metadata
        await db.conversations.update_one(
            {"conversation_id": conversation_id},
            {
                "$set": {"updated_at": datetime.now(timezone.utc)},
                "$inc": {"message_count": 2}  # User + assistant message
            }
        )
        
        return {
            "answer": answer, 
            "chunks": top_chunks,
            "conversation_id": conversation_id,
            "message_count": len(history_messages) + 1  # +1 for new assistant message
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI Chat Error: {e}")

# Optional: Add a simpler chat endpoint that auto-creates conversation
@app.post("/chat")
async def quick_chat(request: Question):
    """
    Simplified chat endpoint that auto-creates conversation if needed
    """
    USER_ID = "default_user"  # In real app, get from auth
    
    # Create new conversation for this chat
    new_conversation = {
        "conversation_id": str(uuid.uuid4()),
        "user_id": USER_ID,
        "title": request.question[:50] + "..." if len(request.question) > 50 else request.question,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
        "message_count": 0,
        "status": "active"
    }
    
    await db.conversations.insert_one(new_conversation)
    
    # Use the conversational endpoint
    message_request = MessageCreate(
        conversation_id=new_conversation["conversation_id"],
        question=request.question
    )
    
    result = await chat_with_conversation(new_conversation["conversation_id"], message_request)
    result["conversation"] = new_conversation  # Include conversation info
    
    return result
    
@app.post("/conversations")
async def create_conversation(conversation: ConversationCreate):
    
    new_conversation = {
        "conversation_id": str(uuid.uuid4()),
        "user_id": conversation.user_id,
        "title": conversation.title,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
        "message_count": 0,
        "status": "active"
    }
    
    result = await db.conversations.insert_one(new_conversation)
    
    new_conversation["_id"] = str(result.inserted_id)
    
    return {"success": True, "conversation": new_conversation}

@app.get("/conversations")
async def get_conversation(user_id: str, skip: int = 0, limit: int = 20):
    cursor = db.conversations.find({"user_id":user_id}).sort("updated_at",-1).skip(skip).limit(limit)
    
    conversations = []
    async for conv in cursor:
        conv["_id"] = str(conv["_id"])
        conversations.append(conv)
        
    total_count = await db.conversations.count_documents({"user_id": user_id})
    
    return {
        "conversations": conversations,
        "total": total_count,
        "skip": skip,
        "limit": limit
        }

@app.put("/conversations/{conversation_id}")
async def update_conversation(conversation_id: str, updates: ConversationUpdate):
    # Explicitly type the dictionary to allow mixed types
    update_data: Dict[str, Union[str, datetime]] = {
        "updated_at": datetime.now(timezone.utc)
    }
    
    if updates.title is not None:
        update_data["title"] = updates.title
    if updates.status is not None:
        update_data["status"] = updates.status
    
    updated_conv = await db.conversations.find_one_and_update(
        {"conversation_id": conversation_id},
        {"$set": update_data},
        return_document=True
    )
    
    if updated_conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    updated_conv["_id"] = str(updated_conv["_id"])
    
    return {"success": True, "conversation": updated_conv}

@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: str):
    # Use transaction to ensure both conversation and messages are deleted
    async with await client.start_session() as session:
        async with session.start_transaction():
            # Delete all messages in conversation
            message_result = await db.messages.delete_many(
                {"conversation_id": conversation_id},
                session=session
            )
            
            # Delete conversation
            conv_result = await db.conversations.delete_one(
                {"conversation_id": conversation_id},
                session=session
            )
            
            if conv_result.deleted_count == 0:
                raise HTTPException(status_code=404, detail="Conversation not found")
    
    return {
        "success": True,
        "deleted_conversation": True,
        "deleted_messages": message_result.deleted_count
    }

@app.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(
    conversation_id: str, 
    skip: int = 0, 
    limit: int = 50,
    order: str = "asc"  # "asc" for chronological, "desc" for recent first
):
    # Verify conversation exists
    conversation = await db.conversations.find_one({"conversation_id": conversation_id})
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    # Set sort order
    sort_order = 1 if order == "asc" else -1
    
    # Query messages
    cursor = db.messages.find(
        {"conversation_id": conversation_id}
    ).sort("timestamp", sort_order).skip(skip).limit(limit)
    
    messages = []
    async for msg in cursor:
        msg["_id"] = str(msg["_id"])
        messages.append(msg)
    
    # Get total message count
    total_messages = await db.messages.count_documents(
        {"conversation_id": conversation_id}
    )
    
    return {
        "messages": messages,
        "total": total_messages,
        "conversation_id": conversation_id,
        "skip": skip,
        "limit": limit
    }
     
@app.post("/voice/transcribe")
async def transcribe_audio(
    audio_file: UploadFile = File(...),
    language: Optional[str] = None  # Optional language parameter
):
    """
    Convert audio to text using Whisper API
    Supports auto-detection or specific language selection
    """
    
    # Validate file
    if not audio_file.content_type or not audio_file.content_type.startswith('audio/'):
        raise HTTPException(status_code=400, detail="File must be audio format")
    
    # Validate file size (Whisper has 25MB limit)
    if audio_file.size and audio_file.size > 25 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 25MB)")
    
    # Create temporary file for Whisper
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_file:
        content = await audio_file.read()
        temp_file.write(content)
        temp_file_path = temp_file.name
    
    try:
        with open(temp_file_path, "rb") as audio:
            # Prepare parameters for Whisper API
            whisper_params = {
                "model": "whisper-1",
                "file": audio,
                "response_format": "verbose_json"  # Get detailed response with language detection
            }
            
            # Only add language if specified (let Whisper auto-detect otherwise)
            if language and language != 'auto':
                whisper_params["language"] = language
            
            transcript = openai.audio.transcriptions.create(**whisper_params)
        
        # Extract information from the response
        transcribed_text = transcript.text
        detected_language = getattr(transcript, 'language', 'unknown')
        
        # Calculate average confidence if segments are available
        confidence = None
        if hasattr(transcript, 'segments') and transcript.segments:
            # Calculate average confidence from all segments
            total_confidence = sum(segment.avg_logprob for segment in transcript.segments)
            confidence = total_confidence / len(transcript.segments)
            # Convert log probability to a more intuitive confidence score (0-1)
            confidence = max(0, min(1, (confidence + 1) / 1))  # Rough conversion
        
        return {
            "text": transcribed_text,
            "language": detected_language,
            "confidence": confidence,
            "success": True,
            "auto_detected": language is None or language == 'auto'
        }
        
    except openai.APIError as e:
        error_message = str(e)
        if "invalid_request_error" in error_message:
            raise HTTPException(status_code=400, detail="Invalid audio format or corrupted file")
        elif "rate_limit_exceeded" in error_message:
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Please try again later.")
        else:
            raise HTTPException(status_code=500, detail=f"OpenAI API error: {error_message}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    
    finally:
        # Cleanup temp file
        if os.path.exists(temp_file_path):
            os.unlink(temp_file_path)