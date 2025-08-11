class CostProjection:
    def __init__(self):
        pass

    def calculate_token(self, query):
        if not query:
            return 0
        token_count = len(query) / 4
        return round(token_count)
    
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
    
a = CostProjection()
print(a.calculate_token("what is the taxiation process in leasing applications"))