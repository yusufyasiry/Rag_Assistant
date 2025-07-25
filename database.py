from pymongo.mongo_client import MongoClient
from loaders import Loader
from embedder import Embedder


uri = "mongodb+srv://admin:123456!@cluster0.fwq8r3i.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
client = MongoClient(uri)
db = client["support_assistant"]
collection = db["embeddings"]
messages = db["messages"]
conversations = db["conversations"]


#loader = Loader()
#docs = loader.load_pdf("./data/data.txt")
#texts = [doc.page_content for doc in docs]
#embedder = Embedder()
#embeddings = embedder.embed(texts)

#for doc, emb in zip(docs, embeddings):
    #record = {
        #"content": doc.page_content,
        #"embedding": emb,
        #"metadata": doc.metadata  
    #}
    #collection.insert_one(record)

#print("Insertion Completed")
    

