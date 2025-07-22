from langchain_unstructured import UnstructuredLoader
from unstructured.cleaners.core import clean_extra_whitespace
from langchain_community.document_loaders.csv_loader import UnstructuredCSVLoader
from langchain_community.document_loaders import UnstructuredHTMLLoader
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
import oracledb


class Loader:
    def __init__(self) -> None:
        pass
        
    
    def load_pdf(self, file_path:str) -> list:
        loader = UnstructuredLoader(file_path=file_path, post_processors=[clean_extra_whitespace])
        documents = loader.load()
        return documents
    
    
    def load_csv(self, file_path:str) -> list:
        loader = UnstructuredCSVLoader(file_path=file_path, mode="elements")
        documents = loader.load()
        return documents
    
    def load_html(self, file_path:str) -> list:
        loader = UnstructuredHTMLLoader(file_path)
        documents = loader.load()
        
        for i in range(len(documents)):
            documents[i].page_content = documents[i].page_content.replace("\n\n", " ").replace("\n", " ")
        
        text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=100,
    )
        
        splitted_docs = text_splitter.split_documents(documents)
        return splitted_docs
            



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
    
class Splitter:
    def __init__(self) -> None:
        pass
    
    def split(self, documents):
        text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=100,
    )

        splitted_docs = text_splitter.split_documents(documents)
        return splitted_docs






        
    
    
    
#if __name__ == "__main__":
    #pdf_path = "./data/dummy_long_file.pdf"
    #l1 = Loader()
    #pdf = l1.load_pdf(pdf_path)
    
    #print(pdf)
    
    #print()
    #print("="*150)
    #print()

    # for i in range(len(pdf)):
    #     print(pdf[i].page_content)
    
#--------------------------------------------------

    #csv_path = "./data/sample.csv"
    #csv = l1.load_csv(csv_path)
    
    #print(csv)
    
    #print()
    #print("="*150)
    #print()
    
    # for i in range(len(csv)):
    #    print(csv[i].page_content)
        
#--------------------------------------------------

    #html_path = "./data/sample.html"
    #html = l1.load_html(html_path)
    #print(html)
    
    #print()
    #print("="*150)
    #print()
    
#--------------------------------------------------

#loader = OracleSQLLoader(
    #user="dummy_user",
    #password="123456",
    #dsn="localhost:1521/xepdb1",
    #query="SELECT * FROM rag_documents",
    #content_column="CONTENT",
    #metadata_columns=["ID", "TITLE"]
#)

#data = loader.load()
#print(data)

#print()
#print("="*150)
#print()

#--------------------------------------------------


    
#--------------------------------------------------
#cats = l1.load_pdf("./data/data.txt")
#print(cats)