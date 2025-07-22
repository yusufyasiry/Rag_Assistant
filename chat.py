from pymongo.mongo_client import MongoClient
from openai import OpenAI
from embedder import Embedder
import os
import dotenv
import openai



uri = "mongodb+srv://admin:123456!@cluster0.fwq8r3i.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0"
client = MongoClient(uri)
db = client["support_assistant"]
collection = db["embeddings"]

embedder = Embedder()
user_query = input("How can I help you ? \n")
query_embedding  = embedder.embed(user_query)[0]


results = collection.aggregate([
    {
        "$vectorSearch": {
            "queryVector":query_embedding,
            "path": "embedding",
            "numCandidates": 100,
            "limit": 10,
            "index": "vector_index"
        }
    }
])

relevant_chunks = [doc["content"] for doc in results]
context = "\n\n".join(relevant_chunks)



dotenv.load_dotenv()
openai.api_key = os.getenv("OPEN_API_KEY")
gpt = OpenAI()


prompt = f"""You are an expert assistant who asnwer the questions based on the following rules. 
        
    Rules:
    - Use formal language be clear and precise.
    - Do NOT refer to the text directly like: "this text states that", "the data you gave me", "The text does not provide information on" etc... 
    - Answer the question in the language you were asked in. For example if the question asked in Turkish answer in Turkish
    

    Context:
    {context}

    Question:
    {user_query}

    Answer:"""


response = openai.chat.completions.create(
    model = "gpt-4o",
    messages=[
        {"role":"system", "content": "You are a helpful assistant."},
        {"role": "user", "content": prompt},
    ],
    temperature= 0.3
)
answer = response.choices[0].message.content
print(answer, relevant_chunks)
 

