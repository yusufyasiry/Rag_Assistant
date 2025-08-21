import openai
import dotenv
import os

#dotenv.load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")

class Prompts:
    
    def __init__(self, model="gpt-4o-mini") -> None:
        self.model = model
    
    def generate_multi_query(self, original_query:str):
        rules = f"""
            For the given question, propose up to five related questions to assist them in finding the information they need. 

            Original question: {original_query}
            - Add the original query among the generated ones
            - Use the same language with original query
            - Provide concise, single-topic questions (without compounding sentences) that cover various aspects of the topic.
            - Ensure each question is complete and directly related to the original inquiry. 
            - List each question on a separate line without numbering.
            - Just return the questions only.
            """
        
        try:   
            response = openai.chat.completions.create(
                model = self.model,
                messages=[
                    {"role":"system", "content": "You are a helpful assistant that very talented at generating similar queries from original while keeping the original meaning"},
                    {"role":"system", "content": f"You need to obey every rule in {rules}"},
                    {"role": "user", "content": original_query},
                ],
                temperature= 1.0
            )
            
            content = response.choices[0].message.content
        
            if content is None:
                return [original_query]  
            
            questions = [line.strip() for line in content.split("\n") if line.strip()]
            
            return questions if questions else [original_query]
            
        except Exception as e:
            print(f"Error generating multi-query: {e}")
            return [original_query] 
    
    def extract_conversation_context(self,chat_history):
        rules = """
                HARD RULES (must obey):
                1) Use ONLY the information in Chat History. Do NOT invent facts, preferences, or intents that are not present or directly implied.
                2) Prefer the most recent turns when conflicts appear; resolve contradictions by favoring recency.
                3) Be multilingual-aware: detect the user’s language trend; set "output_language" following OUTPUT_LANGUAGE_POLICY (see below).
                4) Keep it concise: each array may have at most 7 items; total tokens ≤ MAX_OUTPUT_TOKENS.
                5) Output MUST be valid JSON, exactly matching the schema. No extra text.
                6) If something is unknown or not stated, return an empty array or null (don’t guess).
                
                
                OUTPUT_LANGUAGE_POLICY:
                - If OUTPUT_LANGUAGE is "match-last-user", then set "output_language" to the language of the last user message in Chat History.
                - If OUTPUT_LANGUAGE is a BCP-47 tag (e.g., "en", "tr"), use that explicitly.
                
                SCORING:
                - For each fact/intention you include, add a confidence between 0.0 and 1.0 based on support strength within the history (recency + repetition + explicitness).
                - Prefer fewer, high-confidence items over many low-confidence items.
                
                SELECTION/LIMITING:
                - If Chat History is long, semantically select only the most relevant spans to the current user goal (recent question + repeated themes). Do not exceed MAX_HISTORY_TOKENS of internal consideration. Summarize earlier content if needed.
                
                PROHIBITED CONTENT:
                - No source citations, URLs, or IDs.
                - No policies or meta commentary.
                
                JSON SHAPE (must match exactly):
                {
                "output_language": "string",                 
                "current_user_intent": {"text": "string", "confidence": number},
                "primary_topics": [{"text": "string", "confidence": number}],
                "domain_terms": [{"term": "string", "definition_or_role": "string", "confidence": number}],
                "entities": [{"name": "string", "type": "string", "note": "string", "confidence": number}],
                "user_preferences": {
                    "tone": {"value": "string|null", "confidence": number},
                    "formality": {"value": "informal|neutral|formal|null", "confidence": number},
                    "answer_length": {"value": "brief|medium|detailed|null", "confidence": number},
                    "language_consistency": {"value": "match-user|fixed|mixed|null", "confidence": number}
                },
                "constraints": [{"text": "string", "confidence": number}],
                "known_facts": [{"text": "string", "confidence": number}],
                "open_questions": [{"text": "string", "confidence": number}],
                "follow_up_opportunities": [{"text": "string", "confidence": number}],
                "conversation_timeline": {
                    "last_user_message": "string|null",
                    "last_assistant_message": "string|null"
                }
                }
                """
        user_prompt = f"""
                Return ONLY the JSON object. Do not include any other text.

                Parameters:
                - OUTPUT_LANGUAGE = "match-last-user"   
                - MAX_OUTPUT_TOKENS = 400             
                - MAX_HISTORY_TOKENS = 2000         

                Chat History (JSON):
                {chat_history}
                """
        
        try:   
            response = openai.chat.completions.create(
                model = self.model,
                messages=[
                    {"role":"system", "content": "You are a Conversation Context Extractor. Your job is to read the provided Chat History and return a compact, strictly-structured JSON “conversation_state” that captures the user’s current goal, constraints, known facts, unresolved questions, and language/tone preferences. This JSON will be fed into the main answering model to preserve conversation flow."},
                    {"role":"system", "content": f"You need to obey every rule in {rules}"},
                    {"role": "user", "content": user_prompt},
                ],
                temperature= 1.0
            )
            
            content = response.choices[0].message.content
        
            if content is None:
                return [chat_history]  
            
            return content
            
        except Exception as e:
            print(f"Error extracting context: {e}")
            return [chat_history]
        
    def generate_enhanced_query(self, chat_history, user_query):
        pass
if __name__ =="__main__":
    prompt = Prompts()
  