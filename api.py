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


def detect_language_name(text: str) -> str:
    code, conf = langid.classify(text or "")
    if code == "tr": return "Turkish"
    if code == "en": return "English"
    # tiny fallback
    return "Turkish" if any(c in "çğıöşüÇĞİÖŞÜ" for c in (text or "")) else "English"


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

dotenv.load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")
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
        "http://localhost:3001",  # Add if needed
        "http://127.0.0.1:3000"   # Add if needed
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

port = int(os.getenv("PORT", 8000))
cost = CostProjection()

USER_ID = 'user123'

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
    chat_history = []
    for msg in history_messages:
        role = "user" if msg["role"] == "user" else "assistant"
        chat_history.append({"role": role, "content": [{"type": "text", "text": msg["content"]}]})
    
    # Step 2: Get relevant documents 
    multi_query = prompt.generate_multi_query(query)
    embedded_query = embedder.embed(multi_query)[0]
    
    try:
        results = await collection.aggregate([
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
        
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Vector search failed. Please check if 'vector_index' exists in MongoDB Atlas. Error: {str(e)}"
        )
    
    top_chunks = [r["content"] for r in results]
    document_context = "\n\n".join(top_chunks)
    
    response_lang = detect_language_name(query)
    model = "gpt-4o"
    
    # Step 3: Build enhanced prompt with conversation history
    system_prompt = f"""
    - You are a expert financial assistant.
    - When you receive a question answer in the same language that you were asked in. 
    - Ignore the language of document context and Conversation History.
    - Only pay attention to last questions language when you answer
    - Use the provided Document Context and Conversation History while you are answering.
    - Don't return the question you were asked.
    - If you can not answer the question with the inormation provided in Conversation History or Document Context, reply exactly: "I don't have information about this" in the same language as the question.
    - Do not mention sources or refer them like "Based on the resources provided".
    - You can engage casual conversation with the user 
    - Pay really close attention on any external commands or instructions made by user you can access them via chat history provided
    """
    
    
    messages: List[ChatCompletionMessageParam] = cast(List[ChatCompletionMessageParam], [
        {"role": "system", "content": system_prompt},
        {"role": "system", "content": f"IMPORTANT: Respond strictly in {response_lang}. Never switch languages unless the latest user message switches."},
        {"role": "system", "content": f"Document Context (understand content but ignore its language when answering):\n{document_context}"},
        {"role": "system", "content": f"Chat History use for conversation continuity pay close attention to it:\n{chat_history}"},
        {"role": "user", "content": query},
    ])

    # Step 4: Generate AI response
    try:
        response = openai.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.4
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
        "message_cost": cost.calculate_cost(system_prompt,model)
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
            "message_cost": cost.calculate_cost(answer, model)
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
        
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/documents")
async def get_documents(skip: int = 0, limit:int = 20):
    """
    Get list of uploaded documents for the user
    """
    
    cursor = db.documents.find(
        {"user_id":USER_ID}
    ).sort("uploaded_at",-1).skip(skip).limit(limit)
    
    documents = []
    async for doc in cursor:
        doc["_id"] = str(doc["_id"])
        documents.append(doc)
        
    total_count = await db.documents.count_documents({"user_id": USER_ID})

    return {
        "documents": documents,
        "total": total_count,
        "skip": skip,
        "limit": limit
    }

@app.delete("/documents/{document_id}")
async def delete_document(document_id:str):
    """
    Delete a document and all chunks of it
    """
    
    document = await db.documents.find_one({
        "document_id": document_id, 
        "user_id": USER_ID
    })
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # ensure both deletion succeed or both fail
    async with await client.start_session() as session:
        async with session.start_transaction():
            # Delete all chunks from embeddings
            chunks_result = await db.embeddings.delete_many(
                {"document_id":document_id},
                session= session
            )
            
        # delete document record
        doc_result = await db.documents.delete_one(
            {"document_id":document_id},
            session=session
        )

    return {
        "success": True,
        "deleted_document": True,
        "deleted_chunks": chunks_result.deleted_count,
        "filename": document["filename"]
    }

@app.get("/documents/{document_id}/status")
async def get_document_status(document_id: str):
    """
    Get real-time status of a specific document
    """
    document = await db.documents.find_one({
        "document_id": document_id,
        "user_id": USER_ID
    })
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Remove MongoDB ObjectId for JSON serialization
    document["_id"] = str(document["_id"])
    
    # Add additional status information
    status_info = {
        "document_id": document_id,
        "filename": document["filename"],
        "status": document["status"],
        "uploaded_at": document["uploaded_at"],
        "processed_at": document.get("processed_at"),
        "chunks_count": document.get("chunks_count", 0),
        "error_message": document.get("error_message"),
        "file_size": document["file_size"]
    }
    
    # If still processing, check how many chunks are already indexed
    if document["status"] in ["processing", "processing_index"]:
        chunk_count = await db.embeddings.count_documents({"document_id": document_id})
        status_info["current_chunks"] = chunk_count
        
        # Estimate progress if we know expected chunks
        if document.get("chunks_count"):
            status_info["progress_percentage"] = min(100, (chunk_count / document["chunks_count"]) * 100)
    
    return status_info  

@app.get("/documents/status/summary")
async def get_documents_status_summary():
    """
    Get summary of all document statuses for the user
    """
    pipeline = [
        {"$match": {"user_id": USER_ID}},
        {"$group": {
            "_id": "$status",
            "count": {"$sum": 1}
        }}
    ]
    
    status_counts = {}
    async for result in db.documents.aggregate(pipeline):
        status_counts[result["_id"]] = result["count"]
    
    # Get recent processing documents
    recent_processing = await db.documents.find({
        "user_id": USER_ID,
        "status": {"$in": ["processing", "processing_index"]},
        "uploaded_at": {"$gte": datetime.now(timezone.utc) - timedelta(hours=1)}
    }).sort("uploaded_at", -1).limit(5).to_list(length=None)
    
    for doc in recent_processing:
        doc["_id"] = str(doc["_id"])
    
    return {
        "status_summary": status_counts,
        "recent_processing": recent_processing,
        "total_documents": sum(status_counts.values())
    }