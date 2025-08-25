import os
from langchain_openai import OpenAIEmbeddings

class Embedder:
    def __init__(self):
        # Get API key from environment (Docker will provide this)
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY environment variable not set")
            
        self.model = OpenAIEmbeddings(
            model="text-embedding-3-small"
        )     
      
    def embed(self, chunks):
        embeddings = self.model.embed_documents(chunks)
        return embeddings