
from loaders import Loader
from langchain_core.documents import Document
import os


class Ingestor:
    def __init__(self, folder_path: str):
        self.folder_path = folder_path
        self.loader = Loader()
        
    def ingest_all(self) -> list[Document]:
        documents = []
        
        for filename in os.listdir(self.folder_path):
            file_path = os.path.join(self.folder_path, filename)

            if not os.path.isfile(file_path):
                continue

            try:
                # Use the single file method for consistency
                docs = self.ingest_single_file(file_path)
                documents.extend(docs)
                
            except Exception as e:
                print(f"[ERROR] Failed to load {filename}: {e}")

        return documents
    
    def ingest_single_file(self, file_path: str) -> list[Document]:
        # Check if file exists
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"File not found: {file_path}")
        
        if not os.path.isfile(file_path):
            raise ValueError(f"Path is not a file: {file_path}")
        
        # Get file extension
        filename = os.path.basename(file_path)
        ext = os.path.splitext(filename)[-1].lower()
        
        # Process file based on extension
        try:
            if ext == ".pdf":
                docs = self.loader.load_pdf(file_path)
            elif ext == ".txt":
                docs = self.loader.load_txt(file_path)
            elif ext == ".csv":
                docs = self.loader.load_csv(file_path)
            elif ext in [".html", ".htm"]:
                docs = self.loader.load_html(file_path)
            else:
                raise ValueError(f"Unsupported file type: {ext}. Supported types: .pdf, .txt, .csv, .html, .htm")
            
            # Add file path to metadata for tracking
            for doc in docs:
                if doc.metadata is None:
                    doc.metadata = {}
                doc.metadata['source_file'] = file_path
                doc.metadata['filename'] = filename
                doc.metadata['file_extension'] = ext
            
            return docs
            
        except Exception as e:
            raise Exception(f"Failed to process file {filename}: {str(e)}")