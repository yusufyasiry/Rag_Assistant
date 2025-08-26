from langchain_community.document_loaders import UnstructuredPDFLoader
from unstructured.cleaners.core import clean_extra_whitespace
from langchain_community.document_loaders.csv_loader import UnstructuredCSVLoader
from langchain_community.document_loaders import UnstructuredHTMLLoader
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os

class Loader:
    def __init__(self, chunk_size=500, chunk_overlap=100) -> None:
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def _split_documents(self, documents):
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap    
        )
        return splitter.split_documents(documents)

    def _fallback_pdf_processing(self, file_path: str) -> list:
        """Fallback PDF processing using PyPDF2 when unstructured fails"""
        try:
            from PyPDF2 import PdfReader
            
            with open(file_path, 'rb') as file:
                pdf = PdfReader(file)
                text_content = ""
                
                for page_num, page in enumerate(pdf.pages):
                    try:
                        page_text = page.extract_text()
                        if page_text and page_text.strip():
                            text_content += f"{page_text}\n\n"
                    except Exception as e:
                        print(f"Warning: Failed to extract text from page {page_num + 1}: {e}")
                        continue
            
            if not text_content.strip():
                raise Exception("No text content could be extracted from the PDF")
            
            # Create document object
            doc = Document(
                page_content=text_content.strip(),
                metadata={
                    "source": file_path,
                    "filename": os.path.basename(file_path),
                    "processing_method": "fallback_pypdf2"
                }
            )
            
            return self._split_documents([doc])
            
        except ImportError:
            raise Exception("PyPDF2 not available for fallback PDF processing")
        except Exception as e:
            raise Exception(f"Fallback PDF processing failed: {str(e)}")

    def load_pdf(self, file_path: str) -> list:
        """Load PDF with fallback processing for problematic files"""
        try:
            # First, try the standard unstructured approach with safe settings
            loader = UnstructuredPDFLoader(
                file_path=file_path, 
                mode="single",
                strategy="fast",  # Use fast strategy
            )
            documents = loader.load()
            
            # Check if we got meaningful content
            if not documents or not any(doc.page_content.strip() for doc in documents):
                raise Exception("No content extracted with unstructured")
                
            return self._split_documents(documents)
            
        except Exception as e:
            error_msg = str(e).lower()
            
            # Check for known problematic dependencies
            if any(term in error_msg for term in ['pi_heif', 'pillow_heif', 'heif', 'no module named']):
                print(f"Unstructured PDF processing failed ({e}), trying fallback method...")
                return self._fallback_pdf_processing(file_path)
            
            # For other unstructured errors, also try fallback
            elif 'unstructured' in error_msg or 'partition' in error_msg:
                print(f"Unstructured processing error ({e}), trying fallback method...")
                return self._fallback_pdf_processing(file_path)
            
            else:
                # Re-raise other types of errors
                raise e

    def load_csv(self, file_path: str) -> list:
        loader = UnstructuredCSVLoader(file_path=file_path, mode="elements")
        documents = loader.load()
        return self._split_documents(documents)

    def load_html(self, file_path: str) -> list:
        loader = UnstructuredHTMLLoader(file_path)
        documents = loader.load()

        # Optional: clean line breaks
        for i in range(len(documents)):
            documents[i].page_content = documents[i].page_content.replace("\n\n", " ").replace("\n", " ")

        return self._split_documents(documents)
    
    def load_txt(self, file_path) -> list:
        with open(file_path, "r", encoding="utf-8") as f:
            raw_text = f.read()

        doc = Document(page_content=raw_text)

        splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            separators=["\n\n", "\n", ".", " "]
        )

        chunks = splitter.split_documents([doc])
        return chunks