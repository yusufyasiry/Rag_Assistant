from pymongo.mongo_client import MongoClient
from openai import OpenAI
from embedder import Embedder
import os
import dotenv
import openai
from pydantic import BaseModel
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from prompts import Prompts
from fastapi.responses import JSONResponse
from typing import List
from loaders import Loader
from ingestor import Ingestor
import shutil
import hashlib
import requests
import json
from requests.auth import HTTPDigestAuth

class Question(BaseModel):
    question:str

def generate_file_hash(file_content: bytes) -> str:
    """Generate MD5 hash for file content to detect duplicates"""
    return hashlib.md5(file_content).hexdigest()

# Atlas Admin API Functions
def create_atlas_search_index():
    """
    Create search index using Atlas Admin API
    You need to set these environment variables in your .env file:
    - ATLAS_PUBLIC_KEY: Your Atlas API public key
    - ATLAS_PRIVATE_KEY: Your Atlas API private key  
    - ATLAS_PROJECT_ID: Your Atlas project ID
    - ATLAS_CLUSTER_NAME: Your cluster name (e.g., "Cluster0")
    """
    
    # Atlas API credentials from environment variables
    public_key = os.getenv("ATLAS_PUBLIC_KEY")
    private_key = os.getenv("ATLAS_PRIVATE_KEY")
    project_id = os.getenv("ATLAS_PROJECT_ID")
    cluster_name = os.getenv("ATLAS_CLUSTER_NAME")
    
    if not all([public_key, private_key, project_id, cluster_name]):
        print("⚠️  Missing Atlas API credentials. Please add to your .env file:")
        print("ATLAS_PUBLIC_KEY=your_public_key")
        print("ATLAS_PRIVATE_KEY=your_private_key")
        print("ATLAS_PROJECT_ID=your_project_id")
        print("ATLAS_CLUSTER_NAME=your_cluster_name")
        return False
    
    # Ensure we have string values (not None)
    public_key = str(public_key)
    private_key = str(private_key)
    project_id = str(project_id)
    cluster_name = str(cluster_name)
    
    # Atlas Admin API URL
    url = f"https://cloud.mongodb.com/api/atlas/v1.0/groups/{project_id}/clusters/{cluster_name}/fts/indexes"
    
    # Index definition
    index_definition = {
        "name": "vector_index",
        "database": "test-db",
        "collectionName": "embeddings",
        "type": "vectorSearch",
        "definition": {
            "fields": [
                {
                    "type": "vector",
                    "path": "embedding",
                    "numDimensions": 1536,
                    "similarity": "cosine"
                }
            ]
        }
    }
    
    try:
        print("🔄 Creating search index via Atlas Admin API...")
        
        # Make API request
        response = requests.post(
            url,
            auth=HTTPDigestAuth(public_key, private_key),
            headers={"Content-Type": "application/json"},
            data=json.dumps(index_definition),
            timeout=30
        )
        
        if response.status_code == 201:
            print("✅ Search index created successfully!")
            return True
        elif response.status_code == 409:
            print("ℹ️  Search index already exists")
            return True
        else:
            print(f"❌ Failed to create index. Status: {response.status_code}")
            print(f"Response: {response.text}")
            return False
            
    except requests.exceptions.Timeout:
        print("⏰ Request timed out. Index creation may still be in progress.")
        return False
    except Exception as e:
        print(f"❌ Error creating search index: {e}")
        return False

def check_atlas_search_index():
    """Check if the search index exists using Atlas Admin API"""
    
    public_key = os.getenv("ATLAS_PUBLIC_KEY")
    private_key = os.getenv("ATLAS_PRIVATE_KEY")
    project_id = os.getenv("ATLAS_PROJECT_ID")
    cluster_name = os.getenv("ATLAS_CLUSTER_NAME")
    
    if not all([public_key, private_key, project_id, cluster_name]):
        return {"error": "Missing Atlas API credentials"}
    
    # Ensure we have string values (not None)
    public_key = str(public_key)
    private_key = str(private_key)
    project_id = str(project_id)
    cluster_name = str(cluster_name)
    
    url = f"https://cloud.mongodb.com/api/atlas/v1.0/groups/{project_id}/clusters/{cluster_name}/fts/indexes/test-db/embeddings"
    
    try:
        response = requests.get(
            url,
            auth=HTTPDigestAuth(public_key, private_key),
            timeout=10
        )
        
        if response.status_code == 200:
            indexes = response.json()
            vector_indexes = [idx for idx in indexes if idx.get('name') == 'vector_index']
            return {
                "exists": len(vector_indexes) > 0,
                "indexes": vector_indexes,
                "status": vector_indexes[0].get('status') if vector_indexes else None
            }
        else:
            return {"error": f"Failed to fetch indexes: {response.status_code}"}
            
    except Exception as e:
        return {"error": str(e)}

def check_search_index_works():
    """Test if vector search actually works"""
    try:
        db_test = client["test-db"]
        collection_test = db_test["embeddings"]
        
        # Try a simple vector search to test if index works
        test_vector = [0.1] * 1536  # Simple test vector
        
        result = list(collection_test.aggregate([
            {
                "$vectorSearch": {
                    "queryVector": test_vector,
                    "path": "embedding",
                    "numCandidates": 1,
                    "limit": 1,
                    "index": "vector_index"
                }
            }
        ]))
        
        return True
        
    except Exception as e:
        return False

    
#connecting db
client = MongoClient("mongodb+srv://admin:123456!@cluster0.fwq8r3i.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
db = client["support_assistant"]
collection = db["embeddings"]

#getting open ai api 
dotenv.load_dotenv()
openai.api_key = os.getenv("OPEN_API_KEY")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],  # Allow React app
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return{"This is":"root"}

@app.post("/get_question")
def get_question(request:Question): 
    prompt = Prompts()
    embedder = Embedder()
    query = request.question
    multi_query = prompt.generate_multi_query(query)
    embedded_query = embedder.embed(multi_query)[0]
    
    try:
        results = list(collection.aggregate([
            {
                "$vectorSearch": {
                    "queryVector": embedded_query,
                    "path": "embedding",
                    "numCandidates": 100,
                    "limit": 10,
                    "index": "vector_index"  
                }
            }
        ]))
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Vector search failed. Please check if 'vector_index' exists in MongoDB Atlas. Error: {str(e)}"
        )
    
    top_chunks = [r["content"] for r in results]
    context = "\n\n".join(top_chunks)
    
    prompt = f"""You are an expert assistant who asnwer the questions based on the following rules. 
        
    Rules:
    - Use formal language be clear and precise.
    - Do NOT refer to the text directly like: "this text states that", "the data you gave me", "The text does not provide information on" etc... 
    - Answer the question in the language you were asked in. For example if the question asked in Turkish answer in Turkish
    - When you asked about political figures return I don't have an opinion about that
    - If you don't have enough information about question or the question is out of context return I don't have information about this

    Context:
    {context}

    Question:
    {query}

    Answer:"""
    
    try:
        response = openai.chat.completions.create(
            model = "gpt-4o",
            messages=[
                {"role":"system", "content": "You are a helpful assistant."},
                {"role": "user", "content": prompt},
            ],
            temperature= 0.4
        )
        answer = response.choices[0].message.content
        return {"answer":answer, "chunks":top_chunks}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OpenAI Chat Error: {e}")