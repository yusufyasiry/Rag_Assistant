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




class Question(BaseModel):
    question:str
    
#connecting db
client = MongoClient("mongodb+srv://admin:123456!@cluster0.fwq8r3i.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
db = client["support_assistant"]
collection = db["embeddings"]

#getting open ai api 
dotenv.load_dotenv()
openai.api_key = os.getenv("OPEN_API_KEY")


app =FastAPI()

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
 
@app.post("/upload_file")   
async def upload_files(files: List[UploadFile] = File(None)):
    loader = Loader()
    if not files:
        return JSONResponse(status_code=400, content={"error": "No files uploaded"})
    
    for file in files:
        file_name = file.filename
        ext = str(file_name).split(".")[1]
        
        #if ext in ["pdf", "txt"]:
            #docs = loader.load_pdf(file)
        #elif ext == "csv":
            #docs = loader.load_csv(file)
        #elif ext in ["html", "htm"]:
            #docs = loader.load_html(file)
        
        
        
    return JSONResponse(content={"files": file_name})


#@app.post("/upload_documents"):
#def upload_document(document):
#take the file -> chunk -> embed -> db -> index -> db
#might need a new ingestion method