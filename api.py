from pymongo.mongo_client import MongoClient
from embedder import Embedder
import os
import dotenv
import openai 
from pydantic import BaseModel
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from prompts import Prompts
from datetime import datetime, timezone, timedelta
import uuid
from motor.motor_asyncio import AsyncIOMotorClient
from typing import Dict, Optional, Union, cast, List
import tempfile
from pathlib import Path
from calculate_cost import CostProjection
import langid
from openai.types.chat import ChatCompletionMessageParam
import shutil
from ingestor import Ingestor
import asyncio
from fastapi.responses import StreamingResponse
import io



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
    
class DocumentUpload(BaseModel):
    filename:str
    file_size:int

class DocumentResponse:
    document_id = str
    filename:str
    file_size:int 
    status:str
    chunks_count: Optional[int] = None
    uploaded_at: datetime
    processed_at: Optional[datetime] = None
    error_message: Optional[str] = None

class TTSRequest(BaseModel):
    text: str
    language: Optional[str] = None  # Auto-detect if not specified
    voice: str = "nova"  # OpenAI TTS voice


def detect_language_name(text: str) -> str:
    code, conf = langid.classify(text or "")
    if code == "tr": return "Turkish"
    if code == "en": return "English"
    # tiny fallback
    return "Turkish" if any(c in "çğıöşüÇĞİÖŞÜ" for c in (text or "")) else "English"

def detect_language_code(text: str) -> str:
    """
    Detect language and return language code for TTS
    Enhanced with proper confidence handling for langid
    """
    if not text or not text.strip():
        return "en"  # Default to English for empty text
    
    try:
        code, confidence = langid.classify(text)
        print(f"Language detection: '{text[:30]}...' -> {code} (confidence: {confidence:.2f})")
        
        # Note: langid confidence is actually a log probability, so negative values are normal
        # Higher (less negative) values indicate better confidence
        # Typical range is around -1000 to -50 for confident predictions
        
        # For langid, we should look at the actual language code and do character-based validation
        # rather than relying solely on the confidence score
        
        # Map language codes to supported TTS languages
        language_map = {
            "tr": "tr",  # Turkish
            "en": "en",  # English
            "de": "de",  # German
            "fr": "fr",  # French
            "es": "es",  # Spanish
            "it": "it",  # Italian
            "pt": "pt",  # Portuguese
            "ru": "ru",  # Russian
            "ja": "ja",  # Japanese
            "ko": "ko",  # Korean
            "zh": "zh",  # Chinese
            "ar": "ar",  # Arabic
            "hi": "hi",  # Hindi
            "nl": "en",  # Dutch -> English (not supported by OpenAI TTS)
            "pl": "en",  # Polish -> English (not supported by OpenAI TTS)
            "sv": "en",  # Swedish -> English (not supported by OpenAI TTS)
            "da": "en",  # Danish -> English (not supported by OpenAI TTS)
            "no": "en",  # Norwegian -> English (not supported by OpenAI TTS)
            "fi": "en",  # Finnish -> English (not supported by OpenAI TTS)
        }
        
        detected_lang = language_map.get(code, "en")  # Default to English for unsupported languages
        
        # Special handling for Turkish detection using character analysis
        turkish_chars = "çğıöşüÇĞİÖŞÜ"
        turkish_char_count = sum(1 for char in text if char in turkish_chars)
        turkish_ratio = turkish_char_count / len(text) if text else 0
        
        # If we detect Turkish characters or langid says Turkish, use Turkish
        if turkish_char_count > 0 or code == "tr":
            print(f"Turkish detected - chars: {turkish_char_count}, ratio: {turkish_ratio:.3f}, langid: {code}")
            detected_lang = "tr"
        elif code == "en" or confidence > -100:  # High confidence for other languages
            detected_lang = language_map.get(code, "en")
        else:
            # Low confidence, use character-based heuristics
            if any(char in "àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ" for char in text.lower()):
                # Likely European language, keep the detected one if supported
                detected_lang = language_map.get(code, "en")
            else:
                detected_lang = "en"  # Default to English
            
        print(f"Final language decision: {detected_lang}")
        return detected_lang
        
    except Exception as e:
        print(f"Language detection error: {e}, defaulting to English")
        return "en"

async def perform_final_verification(document_id: str) -> bool:
    """
    Perform a comprehensive final verification using actual query patterns
    """
    try:
        # Get a representative chunk from the document
        sample_chunk = await db.embeddings.find_one({"document_id": document_id})
        if not sample_chunk:
            return False
        
        # Create a realistic query from the content
        content = sample_chunk["content"]
        
        # Generate a query similar to how the system would actually be used
        words = content.split()[:10]  # First 10 words
        test_query = " ".join(words)
        
        if len(test_query.strip()) < 10:  # Ensure we have enough content
            return False
        
        # Use the actual embedder and search process
        embedder = Embedder()
        embedded_query = embedder.embed([test_query])[0]
        
        # Perform the same type of search that the chat endpoint uses
        results = await db.embeddings.aggregate([
            {
                "$vectorSearch": {
                    "queryVector": embedded_query,
                    "path": "embedding",
                    "numCandidates": 100,
                    "limit": 10,
                    "index": "vector_index"
                }
            }
        ]).to_list(length=None)
        
        # Check if our document appears in the top results
        for result in results[:5]:  # Check top 5 results
            if result.get("document_id") == document_id:
                print(f"Final verification successful for document {document_id}")
                return True
        
        print(f"Final verification failed for document {document_id} - document not in top search results")
        return False
        
    except Exception as e:
        print(f"Final verification error for document {document_id}: {e}")
        return False

async def verify_document_searchable(document_id: str, max_retries: int = 30, delay: float = 3.0) -> bool:
    """
    Verify that a document's embeddings are searchable in the vector index
    Enhanced with proper retry logic and index readiness checks
    """
    embedder = Embedder()
    
    # Get multiple sample chunks from this document to test search thoroughly
    sample_chunks = await db.embeddings.find({"document_id": document_id}).limit(3).to_list(length=None)
    if not sample_chunks:
        print(f"No chunks found for document {document_id}")
        return False
    
    print(f"Starting verification for document {document_id} with {len(sample_chunks)} test chunks")
    
    for attempt in range(max_retries):
        try:
            found_chunks = 0
            
            # Test multiple chunks to ensure comprehensive searchability
            for i, sample_chunk in enumerate(sample_chunks):
                # Create a test query using the sample content (first 150 chars for better matching)
                test_text = sample_chunk["content"][:150].strip()
                if not test_text:
                    continue
                    
                test_embedding = embedder.embed([test_text])[0]
                
                # Try to search for this document's chunks
                results = await db.embeddings.aggregate([
                    {
                        "$vectorSearch": {
                            "queryVector": test_embedding,
                            "path": "embedding",
                            "numCandidates": 100,
                            "limit": 20,
                            "index": "vector_index"
                        }
                    }
                ]).to_list(length=None)
                
                # Check if any results belong to our document
                for result in results:
                    if result.get("document_id") == document_id:
                        found_chunks += 1
                        print(f"Found chunk {i+1} for document {document_id} in search results")
                        break
            
            # Consider successful if we found at least 2 out of 3 chunks (or all available chunks)
            success_threshold = min(2, len(sample_chunks))
            if found_chunks >= success_threshold:
                print(f"Document {document_id} verification successful: {found_chunks}/{len(sample_chunks)} chunks found")
                return True
            
            print(f"Verification attempt {attempt + 1}/{max_retries}: Found {found_chunks}/{len(sample_chunks)} chunks for document {document_id}")
            
            # Progressive delay - start with shorter delays, increase over time
            current_delay = delay + (attempt * 0.5)  # Increase delay each attempt
            await asyncio.sleep(current_delay)
            
        except Exception as e:
            print(f"Search verification attempt {attempt + 1} failed for document {document_id}: {e}")
            await asyncio.sleep(delay)
    
    print(f"Document {document_id} failed verification after {max_retries} attempts")
    return False

async def background_index_verification(document_id: str):
    """
    Enhanced background task to verify document is searchable and update status
    """
    try:
        print(f"Starting background verification for document {document_id}")
        
        # Initial delay to allow for basic indexing to start
        await asyncio.sleep(5.0)
        
        # Wait for index to be ready with enhanced verification
        is_searchable = await verify_document_searchable(
            document_id, 
            max_retries=30,  # Up to 2.5 minutes of checking
            delay=3.0
        )
        
        if is_searchable:
            # Final verification: do one more comprehensive search test
            final_verification = await perform_final_verification(document_id)
            
            if final_verification:
                # Update status to ready
                await db.documents.update_one(
                    {"document_id": document_id},
                    {
                        "$set": {
                            "status": "ready",
                            "processed_at": datetime.now(timezone.utc)
                        }
                    }
                )
                print(f"Document {document_id} is now fully searchable and ready!")
            else:
                # Failed final verification
                await db.documents.update_one(
                    {"document_id": document_id},
                    {
                        "$set": {
                            "status": "error",
                            "error_message": "Document indexed but failed final verification - please retry"
                        }
                    }
                )
                print(f"Document {document_id} failed final verification")
        else:
            # Mark as error if verification failed
            await db.documents.update_one(
                {"document_id": document_id},
                {
                    "$set": {
                        "status": "error",
                        "error_message": "Document indexed but not searchable after maximum retries - please retry upload"
                    }
                }
            )
            print(f"Document {document_id} failed search verification")
            
    except Exception as e:
        # Handle verification errors
        await db.documents.update_one(
            {"document_id": document_id},
            {
                "$set": {
                    "status": "error",
                    "error_message": f"Index verification failed: {str(e)}"
                }
            }
        )
        print(f"Error verifying document {document_id}: {e}")  

def smart_chunk_text_for_tts(text: str, max_chunk_size: int = 400) -> List[str]:
    """
    Intelligently split text into chunks for TTS processing, optimized for real-time playback.
    Handles Unicode properly and ensures no encoding issues.
    """
    # Ensure input is a proper UTF-8 string
    if isinstance(text, bytes):
        text = text.decode('utf-8')
    
    # Clean and normalize the text
    text = text.strip()
    if not text:
        return [""]
    
    if len(text) <= max_chunk_size:
        return [text]
    
    # Split by sentences first, handling multiple sentence endings
    import re
    sentences = re.split(r'(?<=[.!?])\s+', text)
    
    chunks = []
    current_chunk = ""
    
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue
            
        # If adding this sentence would exceed limit, save current chunk and start new one
        if current_chunk and len(current_chunk) + len(sentence) + 1 > max_chunk_size:
            chunks.append(current_chunk.strip())
            current_chunk = sentence
        else:
            # Add sentence to current chunk
            if current_chunk:
                current_chunk += " " + sentence
            else:
                current_chunk = sentence
        
        # If a single sentence is too long, split it by clauses
        if len(current_chunk) > max_chunk_size:
            # Split by commas, semicolons, or other natural breaks
            parts = re.split(r'(?<=[,;:])\s+', current_chunk)
            temp_chunk = ""
            
            for part in parts:
                part = part.strip()
                if not part:
                    continue
                    
                if temp_chunk and len(temp_chunk) + len(part) + 1 > max_chunk_size:
                    if temp_chunk.strip():
                        chunks.append(temp_chunk.strip())
                    temp_chunk = part
                else:
                    if temp_chunk:
                        temp_chunk += " " + part
                    else:
                        temp_chunk = part
            
            current_chunk = temp_chunk
    
    # Add the last chunk if it exists and has content
    if current_chunk and current_chunk.strip():
        chunks.append(current_chunk.strip())
    
    # Filter out any empty chunks and ensure we have at least one chunk
    chunks = [chunk for chunk in chunks if chunk.strip()]
    if not chunks:
        chunks = [text]
    
    # Ensure all chunks are proper UTF-8 strings
    cleaned_chunks = []
    for chunk in chunks:
        if isinstance(chunk, bytes):
            chunk = chunk.decode('utf-8')
        cleaned_chunks.append(chunk)
    
    print(f"Split text into {len(cleaned_chunks)} chunks for TTS")
    for i, chunk in enumerate(cleaned_chunks):
        print(f"Chunk {i}: {chunk[:50]}..." + (f" (Turkish chars: {sum(1 for c in chunk if c in 'çğıöşüÇĞİÖŞÜ')})" if any(c in 'çğıöşüÇĞİÖŞÜ' for c in chunk) else ""))
    
    return cleaned_chunks

dotenv.load_dotenv()

# Ensure OpenAI client is configured properly
openai.api_key = os.getenv("OPENAI_API_KEY")

# Create OpenAI client with explicit configuration
from openai import OpenAI
openai_client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
)

MONGO_URI = os.getenv("MONGO_URI")

#connecting db
client = AsyncIOMotorClient(MONGO_URI)
db = client["support_assistant"]
collection = db["embeddings"]
messages = db["messages"]
conversations = db["conversations"]
documents = db["documents"]


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",  
        "http://127.0.0.1:3000"   
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
     expose_headers=[  
        "X-Total-Chunks",
        "X-Current-Chunk",
        "X-Detected-Language",
        "X-Chunk-Index",
        "Content-Disposition",
    ],
)

port = int(os.getenv("PORT", 8000))
cost = CostProjection()

USER_ID = 'user123'
voice_model = "tts-1"
text_model = "gpt-4o"

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
    ).sort("timestamp", -1).limit(10)
    
    history_messages = []
    async for msg in history_cursor:
        history_messages.append(msg)
    
    # Reverse to get chronological order
    history_messages.reverse()
    
    # Build conversation context
    chat_history = []
    for msg in history_messages:
        role = "user" if msg["role"] == "user" else "assistant"
        chat_history.append({"role": role, "content": [{"type": "text", "text": msg["content"]}]})
    
    conversation_context = prompt.extract_conversation_context(chat_history=chat_history)
    print(f"CONTEXT-> {conversation_context}")
    
    # Step 2: Get relevant documents 
    multi_query = prompt.generate_multi_query(query)
    embedded_query = embedder.embed(multi_query)[0]
    
    #Enhancing query
    enhanced_prompt = prompt.generate_enhanced_query(user_query=query,chat_history=conversation_context)
    #print(f"ENHANCED PROMPT -> {enhanced_prompt}")
    
    try:
        results = await collection.aggregate([
            {
                "$vectorSearch": {
                    "queryVector": embedded_query,
                    "path": "embedding",
                    "numCandidates": 50,
                    "limit": 5,
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
    
    response_lang = detect_language_name(query)
    
    # Step 3: Build enhanced prompt with conversation history
    system_prompt = f"""
    - You are an expert assistant in finance and leasing procedures in particular.
    - When you receive a question answer in the same language that you were asked in. 
    - Ignore the language of document context and Conversation History.
    - Use the provided Document Context and Conversation History while you are answering.
    - If the only document you see in Document Context is "This is a root doc for search index" this means user haven't uploaded any file yet. In this case DO NOT reply anything but "Please upload your files" in the response language.
    - Don't return the question you were asked.
    - Don't answer the questions out of topic and kindly state that you can't answer that
    - If you can not answer the question with the inormation provided in Conversation History or Document Context, reply exactly: "I don't have information about this" in the same language as the question.
    - Do not mention sources or refer them like "Based on the resources provided".
    - You can engage casual conversation with the user 
    - Pay really close attention on any external commands or instructions made by user you can access them via chat history provided
    """
    
    
    messages: List[ChatCompletionMessageParam] = cast(List[ChatCompletionMessageParam], [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": f"IMPORTANT: Respond strictly in {response_lang}. Never switch languages unless the latest user message switches."},
        {"role": "system", "content": f"Document Context (understand content but ignore its language when answering):\n{document_context}"},
        {"role": "system", "content": f"Conversation Context: use for conversation continuity pay close attention to it:\n{conversation_context}"},
        {"role": "user", "content": query},
    ])

    # Step 4: Generate AI response  
    try:
        response = openai_client.chat.completions.create(
            model=text_model,
            messages=messages,
            temperature=0.3
        )
        answer = response.choices[0].message.content
        
        
        #Step 5: Store user message
        user_message = {
        "message_id": str(uuid.uuid4()),
        "conversation_id": conversation_id,
        "role": "user",
        "content": query,
        "timestamp": datetime.now(timezone.utc),
        "token_count": cost.calculate_token(system_prompt) ,
        "message_cost": cost.calculate_cost(system_prompt,text_model)
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
            "message_cost": cost.calculate_cost(answer, text_model)
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

@app.post("/voice/text-to-speech/chunk/{chunk_index}")
async def text_to_speech_chunk(chunk_index: int, request: TTSRequest):
    """
    Get a specific chunk of text for TTS - optimized for real-time streaming
    """
    try:
        # Auto-detect language if not specified or set to 'auto'
        if not request.language or request.language == 'auto':
            detected_lang = detect_language_code(request.text)
            print(f"Auto-detected language: {detected_lang} for text: {request.text[:50]}...")
        else:
            detected_lang = request.language
            print(f"Using specified language: {detected_lang}")
        
        # Split text into optimal chunks for real-time playback
        text_chunks = smart_chunk_text_for_tts(request.text, max_chunk_size=400)  # Larger chunks for better performance
        
        # Validate chunk index
        if chunk_index >= len(text_chunks) or chunk_index < 0:
            raise HTTPException(status_code=404, detail="Chunk not found")
        
        # Get the specific chunk
        chunk_text = text_chunks[chunk_index]
        
        # Ensure chunk has content
        if not chunk_text.strip():
            raise HTTPException(status_code=400, detail="Empty chunk")
        
        # Use faster TTS model for real-time performance with language support
        tts_params = {
            "model": "tts-1",  # Faster model for real-time
            "voice": request.voice,
            "input": chunk_text,
            "speed": 1.0,
            "response_format": "mp3"
        }
        
        # Note: OpenAI TTS doesn't use language parameter like other models
        # The voice model automatically handles pronunciation based on text content
        print(f"Creating TTS with voice={request.voice}, detected_lang={detected_lang}")
        
        response = openai.audio.speech.create(**tts_params)
        
        def generate_audio():
            try:
                for chunk in response.iter_bytes(chunk_size=1024):
                    if chunk:
                        yield chunk
            except Exception as e:
                print(f"Error streaming chunk {chunk_index}: {e}")
                raise
        
        return StreamingResponse(
            generate_audio(),
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": f"attachment; filename=speech_chunk_{chunk_index}.mp3",
                "X-Detected-Language": detected_lang,
                "X-Chunk-Index": str(chunk_index),
                "X-Current-Chunk": str(chunk_index),
                "X-Total-Chunks": str(len(text_chunks)),
                "Cache-Control": "no-cache"
            }
        )
        
    except openai.APIError as e:
        error_message = str(e)
        print(f"OpenAI TTS API Error for chunk {chunk_index}: {error_message}")
        
        if "invalid_request_error" in error_message.lower():
            raise HTTPException(status_code=400, detail="Invalid text input or parameters")
        elif "rate_limit_exceeded" in error_message.lower():
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Please try again later.")
        else:
            raise HTTPException(status_code=500, detail=f"TTS API error: {error_message}")
    
    except Exception as e:
        print(f"Unexpected error processing chunk {chunk_index}: {e}")
        raise HTTPException(status_code=500, detail=f"Text-to-speech chunk failed: {str(e)}")
 
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
            
            transcript = openai_client.audio.transcriptions.create(**whisper_params)
        
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

@app.post("/test-language-detection")
async def test_language_detection(request: dict):
    """Test endpoint to verify language detection is working"""
    text = request.get("text", "")
    
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")
    
    # Test language detection
    detected_lang = detect_language_code(text)
    lang_name = detect_language_name(text)
    
    # Get langid raw results for debugging
    import langid
    raw_code, confidence = langid.classify(text)
    
    return {
        "message": "Language detection test",
        "input_text": text,
        "detected_language_code": detected_lang,
        "detected_language_name": lang_name,
        "raw_langid_code": raw_code,
        "raw_langid_confidence": confidence,
        "has_turkish_chars": any(char in "çğıöşüÇĞİÖŞÜ" for char in text),
        "timestamp": datetime.now(timezone.utc)
    }
    
@app.post("/upload-document")
async def upload_document(file: UploadFile = File(...)):
    """
    Upload and process the data
    """
    
    # Validata data
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    
    # Check extension
    allowed_extensions =  ['.pdf', '.txt', '.csv', '.html', '.htm', '.docx']
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {allowed_extensions}")
    
    # Create document record
    document_id = str(uuid.uuid4())
    document_record = {
        "document_id": document_id,
        "filename": file.filename,
        "file_size": file.size,
        "status": "processing",
        "uploaded_at": datetime.now(timezone.utc),
        "user_id": USER_ID
    }
    
    await db.documents.insert_one(document_record)
    
    # save file temporarily
    data_folder = "./data"
    os.makedirs(data_folder, exist_ok=True)
    temp_file_path = os.path.join(data_folder, f"{document_id}_{file.filename}")
    
    try:
        # save uploaded file
        with open(temp_file_path, "wb") as buffer:
            content = await file.read()
            buffer.write(content)
        
        # process the file
        ingestor = Ingestor(data_folder)
        documents_chunks = ingestor.ingest_single_file(temp_file_path)
        
        # create embeddings
        embedder = Embedder()
        texts = [doc.page_content for doc in documents_chunks]
        embeddings = embedder.embed(texts)
        
        # save chunks to embeddings collection
        chunks_inserted = 0
        for doc_chunk, embedding in zip(documents_chunks, embeddings):
            chunk_record = {
                "document_id": document_id,  # Link to source document
                "content": doc_chunk.page_content,
                "embedding": embedding,
                "metadata": doc_chunk.metadata
            }
            await db.embeddings.insert_one(chunk_record)
            chunks_inserted += 1
            
        await db.documents.update_one(
            {"document_id": document_id},
            {
                "$set": {
                    "status": "processing_index",
                    "chunks_count": chunks_inserted,
                    "processed_at": datetime.now(timezone.utc)
                }
            }
        )
        
        # cleanup tempfile
        os.unlink(temp_file_path)
        
        # response
        response_data = {
            "success": True,
            "document_id": document_id,
            "filename": file.filename,
            "chunks_created": chunks_inserted,
            "status": "processing_index"
        }
        
        # background verification
        asyncio.create_task(background_index_verification(document_id))
        
        return response_data
        
    except Exception as e:
        # Cleanup on error
        if os.path.exists(temp_file_path):
            os.unlink(temp_file_path)
        
        # update document status to error
        await db.documents.update_one(
            {"document_id": document_id},
            {"$set": {"status": "error", "error_message": str(e)}}
        )

@app.get("/documents")
async def get_documents(user_id: str = USER_ID, skip: int = 0, limit: int = 50):
    """
    Get all documents for a user
    """
    cursor = db.documents.find({"user_id": user_id}).sort("uploaded_at", -1).skip(skip).limit(limit)
    
    documents = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        documents.append(doc)
    
    total_count = await db.documents.count_documents({"user_id": user_id})
    
    return {
        "documents": documents,
        "total": total_count,
        "skip": skip,
        "limit": limit
    }

@app.get("/documents/{document_id}/status")
async def get_document_status(document_id: str):
    """
    Get the status of a specific document
    """
    document = await db.documents.find_one({"document_id": document_id})
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Calculate progress percentage based on status
    progress_percentage = 0
    if document["status"] == "processing":
        progress_percentage = 30
    elif document["status"] == "processing_index":
        progress_percentage = 70
    elif document["status"] == "ready":
        progress_percentage = 100
    elif document["status"] == "error":
        progress_percentage = 0
    
    return {
        "document_id": document_id,
        "status": document["status"],
        "filename": document["filename"],
        "uploaded_at": document["uploaded_at"],
        "processed_at": document.get("processed_at"),
        "chunks_count": document.get("chunks_count"),
        "current_chunks": document.get("chunks_count", 0),  # For this simple case
        "error_message": document.get("error_message"),
        "progress_percentage": progress_percentage
    }

@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    """
    Delete a document and all its associated chunks
    """
    # Use transaction to ensure both document and embeddings are deleted
    async with await client.start_session() as session:
        async with session.start_transaction():
            # Delete all embeddings for this document
            embeddings_result = await db.embeddings.delete_many(
                {"document_id": document_id},
                session=session
            )
            
            # Delete the document record
            doc_result = await db.documents.delete_one(
                {"document_id": document_id},
                session=session
            )
            
            if doc_result.deleted_count == 0:
                raise HTTPException(status_code=404, detail="Document not found")
    
    return {
        "success": True,
        "deleted_document": True,
        "deleted_chunks": embeddings_result.deleted_count,
        "document_id": document_id
    }        
        
        
        
        
        
        