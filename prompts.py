import openai
import dotenv
import os

#dotenv.load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")

class Prompts:
    
    def __init__(self, model="gpt-4o") -> None:
        self.model = model
    
    def generate_multi_query(self, original_query:str):
        prompt = f"""
            You are a knowledgeable assistant. 
            For the given question, propose up to five related questions to assist them in finding the information they need. 

            Original question: {original_query}

            Provide concise, single-topic questions (without compounding sentences) that cover various aspects of the topic. 
            Ensure each question is complete and directly related to the original inquiry. 
            List each question on a separate line without numbering.
            Generate the questions in the language of the original question for example if the original question is in Turkish generate the other questions in turkish too
            """
        
        try:   
            response = openai.chat.completions.create(
                model = self.model,
                messages=[
                    {"role":"system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": prompt},
                ],
                temperature= 0.4
            )
            
            content = response.choices[0].message.content
        
            if content is None:
                return [original_query]  
            
            questions = [line.strip() for line in content.split("\n") if line.strip()]
            
            return questions if questions else [original_query]
            
        except Exception as e:
            print(f"Error generating multi-query: {e}")
            return [original_query] 
        

