from langchain_community.document_loaders import UnstructuredPDFLoader
from unstructured.cleaners.core import clean_extra_whitespace
from langchain_community.document_loaders.csv_loader import UnstructuredCSVLoader
from langchain_community.document_loaders import UnstructuredHTMLLoader
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
import oracledb




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

    def load_pdf(self, file_path: str) -> list:
        loader = UnstructuredPDFLoader(file_path=file_path, mode="single")
        documents = loader.load()
        return self._split_documents(documents)

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

"""
class OracleSQLLoader:
    def __init__(self, user, password, dsn, query, content_column, metadata_columns=[]):
        self.conn = oracledb.connect(user=user, password=password, dsn=dsn)
        self.query = query
        self.content_column = content_column
        self.metadata_columns = metadata_columns

    def load(self):
        cursor = self.conn.cursor()
        cursor.execute(self.query)
        columns = [desc[0] for desc in cursor.description]
        results = []

        for row in cursor.fetchall():
            row_dict = {col: (val.read() if hasattr(val, "read") else val) for col, val in zip(columns, row)}
            content = row_dict.get(self.content_column, "")
            metadata = {k: row_dict[k] for k in self.metadata_columns if k in row_dict}
            results.append(Document(page_content=str(content), metadata=metadata))

        return results
"""