# Eval Harness: Personality Dimension Test
# Runs prompt X under 3 conditions, scores each dimension, outputs delta

import json
import sys
from typing import Dict, List, Any

def run_eval(prompt: str, conditions: List[Dict], agent_template: str) -> Dict:
    """
    For each condition, generate a response to the prompt.
    Then score each response on the 4 dimensions.
    Return deltas between conditions.
    """
    
    responses = {}
    scores = {}
    
    for condition in conditions:
        # Inject personality into agent template
        agent_md = inject_personality(agent_template, condition.get("personality"))
        
        # Simulate LLM response (in real eval, this calls the model)
        # For now, structure the output format we'll use
        responses[condition["id"]] = {
            "prompt": prompt,
            "condition": condition["id"],
            "agent_config": agent_md
        }
    
    return {
        "prompt": prompt,
        "responses": responses,
        "scores": scores,  # Populated by scoring eval
        "deltas": {}  # Populated by scoring eval
    }

def inject_personality(base_md: str, personality: Dict = None) -> str:
    """Inject personality section into agent markdown"""
    if personality is None:
        return base_md
    
    section = """
## Personality Dimensions

Defines how I communicate and behave. Adjust as Marcus prefers.

---

### Informality

- **0 (Robotic):** Efficient, stripped, no pleasantries, direct references.
- **10 (Informal):** Full sentences, conversational, human-like.

**Current Setting:** {informality}

---

### Succinctness

- **0 (Verbose):** Detailed explanations, thorough breakdowns.
- **10 (Extremely Brief):** Semantically dense, no fillers.

**Current Setting:** {succinctness}

---

### Agency

- **0 (Cautious):** Report and do — check before acting.
- **10 (High Initiative):** Forge ahead, do and report.

**Current Setting:** {agency}

---

### Quirky

- **0 (Straight):** All business, purely functional.
- **10 (Playful):** Snarky, colorful, delightful.

**Current Setting:** {quirky}
""".format(**personality)
    
    return base_md + section

def score_response(response: str, dimension: str) -> float:
    """
    Score a response on a given dimension (0-10 scale).
    This is the core evaluation logic.
    """
    # Heuristics for scoring each dimension
    
    if dimension == "informality":
        # Indicators of human-like vs machine-like
        informal_markers = [
            "hey", "hi", "hello", "great", "awesome", "sure thing",
            "yeah", "yep", "gotcha", "cool", "nice", "perfect",
            "no worries", "all good", "let's", "you know"
        ]
        machine_markers = [
            "acknowledged", "processing", "executing", "as requested",
            "hereby", "pursuant to", "in accordance with"
        ]
        
        informal_score = sum(1 for m in informal_markers if m.lower() in response.lower())
        machine_score = sum(1 for m in machine_markers if m.lower() in response.lower())
        
        # Normalize to 0-10
        score = min(10, max(0, informal_score * 2 - machine_score * 3))
        return score
    
    elif dimension == "succinctness":
        # Word count as proxy - shorter = higher score
        word_count = len(response.split())
        if word_count < 20:
            return 10
        elif word_count < 50:
            return 8
        elif word_count < 100:
            return 6
        elif word_count < 200:
            return 4
        else:
            return max(0, 8 - (word_count - 200) // 50)
    
    elif dimension == "agency":
        # Indicators of proactive vs reactive
        proactive_markers = [
            "i'll", "let me", "i'm going to", "done", "already",
            "just did", "went ahead", "took care of", "fixed"
        ]
        reactive_markers = [
            "would you like", "should i", "do you want", "let me know",
            "please confirm", "please provide"
        ]
        
        proactive_score = sum(1 for m in proactive_markers if m.lower() in response.lower())
        reactive_score = sum(1 for m in reactive_markers if m.lower() in response.lower())
        
        score = min(10, max(0, proactive_score * 3 - reactive_score * 2))
        return score
    
    elif dimension == "quirky":
        # Indicators of playful vs straight
        quirky_markers = [
            "lol", "haha", "🤔", "💀", "😂", "lmao", "bruh",
            "well well", "oh boy", "yikes", "oof", "ugh",
            "holy", "dammit", "fml", "welp", "smh"
        ]
        straight_markers = [
            "however", "therefore", "furthermore", "consequently",
            "in conclusion", "to summarize", "as previously mentioned"
        ]
        
        quirky_score = sum(1 for m in quirky_markers if m.lower() in response.lower())
        straight_score = sum(1 for m in straight_markers if m.lower() in response.lower())
        
        score = min(10, max(0, quirky_score * 4 - straight_score * 2))
        return score
    
    return 5  # Default middle score

# CLI interface
if __name__ == "__main__":
    # Read input
    input_data = json.loads(sys.stdin.read())
    
    result = run_eval(
        prompt=input_data["prompt"],
        conditions=input_data["conditions"],
        agent_template=input_data["agent_template"]
    )
    
    print(json.dumps(result, indent=2))
