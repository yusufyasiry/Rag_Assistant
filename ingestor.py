from loaders import Loader
from langchain_core.documents import Document
from embedder import Embedder
import os


class Ingestor:
    def __init__(self, folder_path:str):
        self.folder_path = folder_path
        self.loader = Loader()
        
    def ingest_all(self)->list[Document]:
        documents=[]
        
        for filename in os.listdir(self.folder_path):
            file_path = os.path.join(self.folder_path, filename)

            if not os.path.isfile(file_path):
                continue

            ext = os.path.splitext(filename)[-1].lower()

            try:
                if ext in [".pdf", ".txt"]:
                    docs = self.loader.load_pdf(file_path)
                elif ext == ".csv":
                    docs = self.loader.load_csv(file_path)
                elif ext in [".html", ".htm"]:
                    docs = self.loader.load_html(file_path)
                else:
                    print(f"Skipping unsupported file: {filename}")
                    continue
                
                documents.extend(docs)
                
            except Exception as e:
                print(f"[ERROR] Failed to load {filename}: {e}")

        return documents
    
    
#if __name__ == "__main__":
    #i1 = Ingestor("./data")
    #e1 = Embedder()
    #docs = i1.ingest_all()
    #print(e1.embed("Hello There"))