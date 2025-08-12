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
from calculate_cost import CostProjection
from openai.types.chat import ChatCompletionMessageParam



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
cost = CostProjection()


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
    
    # Step 1: Get conversation history (last x messages for context)
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
    
    # Step 2: Get relevant documents 
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
    
    # Step 3: Build enhanced prompt with conversation history
    rules = """
    You are a RAG assistant.
    Always answer in the SAME LANGUAGE as the user's last message regardless of the documents language.
    Use only the provided Document Context and Conversation History. 
    If missing, reply exactly: "I don't have information about this.
    Do not mention sources."
    """
    
    context_msg = f"Document Context:\n{document_context}\n\nConversation History:\n{conversation_context}"
    
    messages: list[ChatCompletionMessageParam] = [
    {"role": "system", "content": [{"type": "text", "text": rules}]},
    {"role": "system", "content": [{"type": "text", "text": context_msg}]},
    {"role": "user",   "content": [{"type": "text", "text": query}]},
]
    
    # Step 4: Generate AI response
    try:
        response = openai.chat.completions.create(
            model="gpt-5-mini",
            messages=messages,
            temperature=0.5
        )
        answer = response.choices[0].message.content
        
        
        #Step 5: Store user message
        user_message = {
        "message_id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "role": "user",
        "content": query,
        "timestamp": datetime.now(timezone.utc),
        "token_count": cost.calculate_token(rules),
        "message_cost": cost.calculate_cost(rules,"gpt-5-mini")
        }

        #print(f"User message - Token count: {user_message['token_count']}, Cost: {user_message['message_cost']}")
        
        await db.messages.insert_one(user_message)
        
        # Step 6: Store assistant response
        assistant_message = {
            "message_id": str(uuid.uuid4()),
            "conversation_id": conversation_id,
            "role": "assistant",
            "content": answer,
            "sources": top_chunks,  # Store the source chunks
            "timestamp": datetime.now(timezone.utc),
            "token_count": cost.calculate_token(answer),
            "message_cost": cost.calculate_cost(answer, "gpt-5-mini")
        }
        
        #print(f"Assistant message - Token count: {assistant_message['token_count']}, Cost: {assistant_message['message_cost']}")
        
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
                      
@app.get("/test-cost-calculation")
def test_cost_calculation():
    """Test endpoint to verify cost calculation is working"""
    test_query = "What is the taxation process in leasing applications?"
    
    # Test the cost calculation
    token_count = cost.calculate_token(test_query)
    message_cost = cost.calculate_cost(test_query, "gpt-4o")
    
    return {
        "message": "Cost calculation is working!",
        "test_query": test_query,
        "calculated_tokens": token_count,
        "calculated_cost": message_cost,
        "timestamp": datetime.now(timezone.utc)
    }