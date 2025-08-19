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
        

if __name__ =="__main__":
    prompt = Prompts()
    test = prompt.extract_conversation_context("""[{'role': 'user', 'content': [{'type': 'text', 'text': 'what is leasing'}]}, {'role': 'assistant', 'content': [{'type': 'text', 'text': 'Leasing is a financial arrangement where a company or individual can use an asset, such as equipment, vehicles, or real estate, for a specified period without owning it. The lessee (the user) pays regular rental payments to the lessor (the owner or leasing company) for the use of the asset. At the end of the lease term, the lessee may have the option to purchase the asset, return it, or renew the lease. Leasing allows businesses to access and use assets without the need 
for large upfront capital expenditure, and it can offer tax and accounting benefits.'}]}, {'role': 'user', 'content': [{'type': 'text', 'text': 'what are the adventages of this'}]}, {'role': 'assistant', 'content': [{'type': 'text', 'text': 'Leasing offers several advantages, including:\n\n1. **Tax Benefits**: Leasing payments can often be deducted as business expenses, reducing taxable income. Additionally, certain types of leases may offer specific tax advantages, 
such as reduced VAT rates.\n\n2. **Cash Flow Management**: Leasing allows businesses to use assets without large upfront payments, preserving cash flow for other operational needs.\n\n3. **Flexibility**: At the end of the lease term, businesses may have options to purchase, return, or upgrade the asset, providing flexibility in asset management.\n\n4. **Access to Latest Technology**: Leasing can enable businesses to use the latest equipment and technology without the risk of obsolescence.\n\n5. **Balance Sheet Management**: Operating leases may not appear as liabilities on the balance sheet, potentially improving financial ratios.\n\n6. **Preservation of Credit Lines**: Leasing can preserve existing credit lines for other business opportunities or needs.\n\n7. **Risk Management**: Leasing can transfer some risks associated with asset ownership, such as maintenance and depreciation, to the lessor.'}]}, {'role': 'user', 'content': [{'type': 'text', 'text': 'başka avantajları var mı'}]}, {'role': 'assistant', 'content': [{'type': 'text', 'text': 'Leasingin başka avantajları da bulunmaktadır:\n\n1. **Yatırım Teşvikleri**: Leasing yoluyla temin edilen varlıklar için devletin sunduğu yatırım teşviklerinden faydalanmak mümkündür. Bu teşvikler 
arasında vergi indirimi, KDV istisnası ve gümrük muafiyeti gibi avantajlar yer alabilir.\n\n2. **Amortisman Hızlandırması**: Leasing ile alınan varlıklar için amortisman hızlandırması yapılabilir, bu da vergi avantajı sağlayabilir.\n\n3. **Teminat Güvencesi**: Kiralayan açısından, malın mülkiyeti kendisinde kaldığı için teminat güvencesi daha yüksektir. Kiracı ödeme yapmadığında malı geri almak daha kolaydır.\n\n4. **İkinci El Değeri**: Finansal kiralama şirketleri, 
malın ikinci el değerini kullanarak alacak riskini azaltabilir.\n\n5. **Kredi Sigorta Primleri**: Leasing işlemlerinde, krediyle bağlantılı sigorta primleri 
BSMV’ye tabi olmaz, bu da maliyet avantajı sağlar.\n\nBu avantajlar, leasingi birçok işletme için cazip bir finansman yöntemi haline getirmektedir.'}]}]""")
    print(test)