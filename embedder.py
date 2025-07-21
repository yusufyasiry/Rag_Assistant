from sentence_transformers import SentenceTransformer

class Embedder:
    def __init__(self):
        self.model = SentenceTransformer("all-MiniLM-L6-v2") 
        
    def embed(self, chunks):
        embeddings = self.model.encode(chunks)
        return embeddings