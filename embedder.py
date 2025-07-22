import os
from dotenv import load_dotenv
from langchain_openai import OpenAIEmbeddings

load_dotenv()
OPEN_API_KEY = os.getenv("OPEN_API_KEY")



class Embedder:
    def __init__(self):
        self.model = OpenAIEmbeddings(model="text-embedding-3-small")     
      
    def embed(self, chunks):
        embeddings = self.model.embed_documents(chunks)
        return embeddings
    
    
    
    
    
    
    
    
    

