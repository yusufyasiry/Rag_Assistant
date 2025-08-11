class CostProjection:
    def __init__(self):
        pass

    def calculate_token(self, query):
        if not query:
            return 0
        # More accurate token estimation:
        # - Average English word is ~4-5 characters
        # - Average token is ~4 characters or ~0.75 words
        # - So we use character count / 4 for a rough estimate
        # - But we need to account for spaces and punctuation
        
        # Method 1: Character-based (more accurate for OpenAI models)
        # OpenAI tokens are roughly 4 characters on average
        char_count = len(query)
        token_count = char_count / 4
        
        # Method 2: Word-based alternative (you can switch to this if preferred)
        # word_count = len(query.split())
        # token_count = word_count * 1.3  # 1 word ≈ 1.3 tokens on average
        
        return int(round(token_count))  # Ensure integer result
    
    def calculate_cost(self, query, model):
        prices = {
            "gpt-5": 1.25/1000000,
            "gpt-5-mini": 0.25/1000000,
            "gpt-5-nano": 0.05/1000000,
            "gpt-4o": 5.00/1000000,
            "gpt-4o-mini": 0.60/1000000
        }
        
        if model not in prices:
            return 0.0
            
        # Use self instead of creating new instance
        token_count = self.calculate_token(query)
        cost = token_count * prices[model]
        return float(format(cost, ".3g"))

# Testing code - only runs when this file is executed directly
if __name__ == "__main__":
    a = CostProjection()
    print(a.calculate_token("what is the taxation process in leasing applications"))
    print(a.calculate_cost("what is the taxation process in leasing applications", "gpt-4o"))