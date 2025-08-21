from pymongo.mongo_client import MongoClient
from pymongo.operations import SearchIndexModel
from loaders import Loader
from embedder import Embedder
import os
import dotenv

dotenv.load_dotenv()
MONGO_URI = os.getenv("MONGO_URI")

client = MongoClient(MONGO_URI)
db = client["support_assistant"]
collection = db["embeddings"]
messages = db["messages"]
conversations = db["conversations"]



loader = Loader()
docs = loader.load_txt("./data/test.txt")
texts = [doc.page_content for doc in docs]
embedder = Embedder()
embeddings = embedder.embed(texts)

for doc, emb in zip(docs, embeddings):
    record = {
        "content": doc.page_content,
        "embedding": emb, 
        "metadata": doc.metadata  
    }
    collection.insert_one(record)

print("Insertion Completed")
    

